"""Deploy gemihub-web once, then remove its unused images after HTTP health checks."""
import argparse
import fcntl
import json
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path('/opt/shared-apps')
APP = 'gemihub-web'
STATE_FORMAT = '{"image":{{json .Config.Image}},"running":{{json .State.Running}},"restarts":{{.RestartCount}}}'


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def container_state():
    return json.loads(output('docker', 'inspect', '--format', STATE_FORMAT, APP))


def wait_healthy(image):
    deadline = time.monotonic() + 60
    consecutive = 0
    while time.monotonic() < deadline:
        try:
            state = container_state()
            if state['image'] != image:
                raise RuntimeError('Another image replaced this deployment')
            with urllib.request.urlopen('http://127.0.0.1:8085/health/' + APP, timeout=5) as response:
                healthy = response.status == 200 and state['running'] and state['restarts'] == 0
            consecutive = consecutive + 1 if healthy else 0
            if consecutive >= 3:
                return
        except (OSError, subprocess.CalledProcessError):
            consecutive = 0
        time.sleep(2)
    raise RuntimeError('HTTP health check failed; old images were kept')


def remove_unused_images(image, previous):
    repository = image.rsplit(':', 1)[0]
    if not repository.endswith('/gemihub-web/gemihub-web') or ':' not in image:
        raise ValueError('Only the gemihub-web image repository may be cleaned')
    keep = {image, previous}
    containers = output('docker', 'ps', '-aq').split()
    used = set(output('docker', 'inspect', '--format', '{{.Image}}', *containers).split()) if containers else set()
    rows = output('docker', 'image', 'ls', '--no-trunc', '--filter', 'reference=' + repository, '--format', '{{json .}}').splitlines()
    removed = 0
    for row in rows:
        entry = json.loads(row)
        reference = entry['Repository'] + ':' + entry['Tag']
        if entry['Repository'] != repository or entry['Tag'] == '<none>' or reference in keep or entry['ID'] in used:
            continue
        # Docker also refuses to remove any image acquired by a container during enumeration.
        subprocess.run(['docker', 'image', 'rm', reference], check=True, stdout=subprocess.DEVNULL)
        removed += 1
    print(json.dumps({'event': 'gemihub_image_cleanup', 'removed': removed, 'keptCurrentAndPrevious': True}), flush=True)


def deploy(image):
    try:
        previous = container_state()['image']
    except subprocess.CalledProcessError:
        previous = None
    subprocess.run(['python3', str(ROOT / 'deploy.py'), '--app', APP, '--image', image], check=True)
    # The shared deployer and register.py each acquire this same lock themselves.
    with open(ROOT / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads((ROOT / 'runtime.json').read_text())['apps'][APP]['image']
        if current != image:
            print(json.dumps({'event': 'gemihub_image_cleanup', 'skipped': 'superseded'}), flush=True)
            return
        wait_healthy(image)
    subprocess.run(['python3', str(ROOT / 'register.py'), '--persist'], check=True)
    # This service owns its domain controller; no other application's code or
    # container is restarted. Initial root timer/config installation is separate.
    if Path('/etc/gemihub-domains.json').is_file():
        subprocess.run(['docker', 'cp', APP + ':/app/infra/domain-controller.py', '/opt/gemihub-domains/controller.py'], check=True)
        Path('/opt/gemihub-domains/controller.py').chmod(0o755)
    with open(ROOT / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = json.loads((ROOT / 'runtime.json').read_text())['apps'][APP]['image']
        state = container_state()
        if current != image or state['image'] != image or not state['running'] or state['restarts']:
            print(json.dumps({'event': 'gemihub_image_cleanup', 'skipped': 'deployment changed'}), flush=True)
            return
        remove_unused_images(image, previous)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    deploy(parser.parse_args().image)
