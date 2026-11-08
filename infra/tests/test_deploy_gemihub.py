import fcntl
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location('deploy_gemihub', Path(__file__).parents[1] / 'deploy-gemihub.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
REPO = 'asia-northeast1-docker.pkg.dev/project/gemihub-web/gemihub-web'
CURRENT, PREVIOUS = REPO + ':current', REPO + ':previous'


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.object(deploy, 'ROOT', root).start()
        (root / 'runtime.json').write_text(json.dumps({'apps': {'gemihub-web': {'image': CURRENT}}}))

    def test_cleanup_keeps_current_previous_all_container_images_and_other_repositories(self):
        rows = [
            {'Repository': REPO, 'Tag': tag, 'ID': identifier}
            for tag, identifier in [('current', 'sha-current'), ('previous', 'sha-previous'), ('retained', 'sha-used'), ('old', 'sha-old'), ('<none>', 'sha-dangling')]
        ] + [{'Repository': 'registry/kakeratta', 'Tag': 'frozen', 'ID': 'sha-frozen'}]
        def output(*args):
            if args[:3] == ('docker', 'ps', '-aq'):
                return 'gemihub-web\nkakeratta-web\nother-retained-container'
            if args[:2] == ('docker', 'inspect'):
                return 'sha-current\nsha-frozen\nsha-used'
            return '\n'.join(json.dumps(row) for row in rows)
        with patch.object(deploy, 'output', side_effect=output), patch.object(deploy.subprocess, 'run') as run:
            deploy.remove_unused_images(CURRENT, PREVIOUS)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], ['docker', 'image', 'rm', REPO + ':old'])

    def test_other_app_repository_cannot_be_cleaned(self):
        with self.assertRaises(ValueError), patch.object(deploy.subprocess, 'run') as run:
            deploy.remove_unused_images('registry/kakeratta:frozen', None)
        run.assert_not_called()

    def test_failed_deployment_never_runs_health_registration_or_cleanup(self):
        with patch.object(deploy, 'container_state', return_value={'image': PREVIOUS}), \
             patch.object(deploy.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'deploy')), \
             patch.object(deploy, 'wait_healthy') as health, patch.object(deploy, 'remove_unused_images') as clean:
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.deploy(CURRENT)
            health.assert_not_called()
            clean.assert_not_called()

    def test_unhealthy_deployment_keeps_old_images_and_does_not_persist(self):
        with patch.object(deploy, 'container_state', return_value={'image': PREVIOUS}), \
             patch.object(deploy.subprocess, 'run') as run, \
             patch.object(deploy, 'wait_healthy', side_effect=RuntimeError('unhealthy')), \
             patch.object(deploy, 'remove_unused_images') as clean:
            with self.assertRaises(RuntimeError):
                deploy.deploy(CURRENT)
            self.assertEqual(run.call_count, 1)
            clean.assert_not_called()

    def test_success_checks_health_before_persisting_and_releases_register_lock(self):
        events = []
        def run(args, **kwargs):
            if 'register.py' in args[1]:
                events.append('persist')
                with open(deploy.ROOT / 'deploy.lock', 'a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            else:
                events.append('deploy')
        with patch.object(deploy, 'container_state', side_effect=[{'image': PREVIOUS}, {'image': CURRENT, 'running': True, 'restarts': 0}]), \
             patch.object(deploy.subprocess, 'run', side_effect=run), \
             patch.object(deploy, 'wait_healthy', side_effect=lambda image: events.append('health')), \
             patch.object(deploy, 'remove_unused_images', side_effect=lambda image, previous: events.append(('cleanup', image, previous))):
            deploy.deploy(CURRENT)
        self.assertEqual(events, ['deploy', 'health', 'persist', ('cleanup', CURRENT, PREVIOUS)])

    def test_superseded_deployment_does_not_remove_newer_images(self):
        (deploy.ROOT / 'runtime.json').write_text(json.dumps({'apps': {'gemihub-web': {'image': REPO + ':newer'}}}))
        with patch.object(deploy, 'container_state', return_value={'image': PREVIOUS}), \
             patch.object(deploy.subprocess, 'run'), patch.object(deploy, 'remove_unused_images') as clean:
            deploy.deploy(CURRENT)
            clean.assert_not_called()

    def test_health_rejects_restart_loops_even_with_http_200(self):
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(deploy, 'container_state', return_value={'image': CURRENT, 'running': True, 'restarts': 9}), \
             patch.object(deploy.urllib.request, 'urlopen', return_value=response), \
             patch.object(deploy.time, 'sleep'), patch.object(deploy.time, 'monotonic', side_effect=[0, 0, 61]):
            with self.assertRaises(RuntimeError):
                deploy.wait_healthy(CURRENT)


if __name__ == '__main__':
    unittest.main()
