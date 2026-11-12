#!/usr/bin/env python3
"""Reconcile verified storefront domains. Runs only as a dedicated root timer.

No DNS provider access is needed: owners install the displayed records themselves.
Only the custom Nginx include is reloaded; application containers are untouched.
"""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/opt/shared-apps')
REGISTRY = 'routing/custom-domains.json'


def valid_host(host):
    return isinstance(host, str) and len(host) <= 253 and bool(re.fullmatch(
        r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', host))


def resource_id(host):
    if not valid_host(host):
        raise ValueError('Invalid hostname')
    return 'gemihub-web-custom-' + hashlib.sha256(host.encode()).hexdigest()[:12]


def eligible(shop):
    return (valid_host(shop.get('domain')) and bool(shop.get('domainToken')) and
            shop.get('domainVerified') is True and not shop.get('archivedAt') and not shop.get('judge') and
            not any(shop['domain'] == suffix or shop['domain'].endswith('.' + suffix)
                    for suffix in ['gemihub.net', 'kiokuflow.net', 'kakeratta.net', 'geo.mcp.takeshy.work']))


def generation(shop):
    return hashlib.sha256(shop['domainToken'].encode()).hexdigest()


def route_hosts(url_map, hosts, managed):
    """Preserve every other app's host rules and all path matchers."""
    rules = url_map.get('hostRules', [])
    target = next(rule for rule in rules if rule['pathMatcher'] == 'shared-gemihub-web')
    other = {host for rule in rules if rule is not target for host in rule['hosts']}
    if other.intersection(hosts):
        raise ValueError('Hostname belongs to another shared application')
    target['hosts'] = sorted((set(target['hosts']) - set(managed)) | set(hosts))
    return url_map


class Cloud:
    def __init__(self, config):
        self.config = config
        with urllib.request.urlopen(urllib.request.Request(
                'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
                headers={'Metadata-Flavor': 'Google'}), timeout=10) as response:
            bootstrap = json.load(response)['access_token']
        self.token = bootstrap
        self.token = self.request('POST', 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
                                  config['account'] + ':generateAccessToken',
                                  {'scope': ['https://www.googleapis.com/auth/cloud-platform'], 'lifetime': '600s'})['accessToken']
        self.db = f"https://firestore.googleapis.com/v1/projects/{config.get('databaseProject', config['project'])}/databases/{config['database']}/documents"
        self.cert = f"https://certificatemanager.googleapis.com/v1/projects/{config['project']}/locations/global"

    def request(self, method, url, data=None, missing=False):
        request = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(), method=method,
                                         headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read()
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            try:
                detail = json.loads(error.read()).get('error', {}).get('message', '')[:500]
            except (ValueError, AttributeError):
                detail = ''
            print(json.dumps({'event': 'domain_cloud_error', 'code': error.code, 'api': url.split('?')[0], 'detail': detail}), flush=True)
            raise

    def settings(self):
        doc_id = hashlib.sha256(b'domainSettings:current').hexdigest()
        self.request('PATCH', self.db + '/gemihub_state/' + doc_id, {'fields': {
            'kind': {'stringValue': 'domainSettings'}, 'id': {'stringValue': 'current'},
            'json': {'stringValue': json.dumps({'address': self.config['address']})}}})

    def shops(self):
        result = self.request('POST', self.db + ':runQuery', {'structuredQuery': {
            'from': [{'collectionId': 'gemihub_state'}],
            'where': {'fieldFilter': {'field': {'fieldPath': 'kind'}, 'op': 'EQUAL', 'value': {'stringValue': 'shop'}}}}})
        return [json.loads(row['document']['fields']['json']['stringValue']) for row in result if 'document' in row]

    def status(self, shop, status, authorization=None, dns=None):
        value = {'domain': shop['domain'], 'generation': generation(shop), 'status': status,
                 'address': self.config['address'], 'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if authorization:
            value['authorization'] = authorization
        if dns is not None:
            value['dns'] = dns
        doc_id = hashlib.sha256(('domainConnection:' + shop['id']).encode()).hexdigest()
        self.request('PATCH', self.db + '/gemihub_state/' + doc_id, {'fields': {
            'kind': {'stringValue': 'domainConnection'}, 'id': {'stringValue': shop['id']},
            'json': {'stringValue': json.dumps(value)}}})

    def ensure(self, collection, name, value, param):
        url = self.cert + '/' + collection
        existing = self.request('GET', url + '/' + name, missing=True)
        if existing is not None:
            return existing
        try:
            operation = self.request('POST', url + '?' + param + '=' + name, value)
            for _ in range(6):
                if operation.get('done'):
                    if operation.get('error'):
                        raise RuntimeError('Certificate operation failed')
                    break
                time.sleep(1)
                operation = self.request('GET', 'https://certificatemanager.googleapis.com/v1/' + operation['name'])
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
        return self.request('GET', url + '/' + name)

    def certificate(self, host):
        name = resource_id(host)
        auth = self.ensure('dnsAuthorizations', name, {'domain': host, 'type': 'PER_PROJECT_RECORD'}, 'dnsAuthorizationId')
        cert = self.ensure('certificates', name, {'managed': {'domains': [host], 'dnsAuthorizations': [auth['name']]}}, 'certificateId')
        if auth.get('domain') != host or cert.get('managed', {}).get('domains') != [host]:
            raise ValueError('Existing certificate does not match hostname')
        record = auth['dnsResourceRecord']
        return cert, {key: record[key] for key in ['name', 'type', 'data']}

    def attach(self, host, cert):
        path = 'certificateMaps/' + self.config['map'] + '/certificateMapEntries'
        entry = self.ensure(path, resource_id(host), {'hostname': host, 'certificates': [cert['name']]}, 'certificateMapEntryId')
        # The API can normalize project IDs to project numbers in references.
        expected = '/locations/global/certificates/' + resource_id(host)
        if entry.get('hostname') != host or not any(name.endswith(expected) for name in entry.get('certificates', [])):
            raise ValueError('Certificate map entry does not match hostname')

    def registry(self):
        url = 'https://storage.googleapis.com/storage/v1/b/' + self.config['bucket'] + '/o/' + urllib.parse.quote(REGISTRY, safe='') + '?alt=media'
        return self.request('GET', url)

    def save_registry(self, registry):
        url = 'https://storage.googleapis.com/upload/storage/v1/b/' + self.config['bucket'] + '/o?uploadType=media&name=' + urllib.parse.quote(REGISTRY, safe='')
        self.request('POST', url, registry)

    def routes(self, hosts):
        previous = self.registry()
        managed = sorted(set(previous.get('managedHosts', [])) | set(previous.get('hosts', [])) | set(hosts))
        registry = {'hosts': sorted(hosts), 'managedHosts': managed}
        url = f"https://compute.googleapis.com/compute/v1/projects/{self.config['project']}/global/urlMaps/{self.config['urlMap']}"
        for attempt in range(3):
            mapping = self.request('GET', url)
            before = json.dumps(mapping, sort_keys=True)
            route_hosts(mapping, hosts, managed)
            if previous != registry:
                self.save_registry(registry)
                previous = registry
            if json.dumps(mapping, sort_keys=True) == before:
                break
            writable = {key: value for key, value in mapping.items() if key in {
                'name', 'description', 'fingerprint', 'defaultService', 'defaultUrlRedirect', 'defaultRouteAction',
                'defaultCustomErrorResponsePolicy', 'hostRules', 'pathMatchers', 'headerAction', 'tests'}}
            try:
                self.request('PUT', url, writable)
                break
            except urllib.error.HTTPError as error:
                if error.code != 412 or attempt == 2:
                    raise
        write_nginx(hosts, self.config['port'])


def dns_values(host, kind):
    url = 'https://dns.google/resolve?' + urllib.parse.urlencode({'name': host, 'type': kind})
    with urllib.request.urlopen(url, timeout=10) as response:
        return [item['data'].rstrip('.') for item in json.load(response).get('Answer', []) if item['type'] == {'A': 1, 'AAAA': 28, 'CNAME': 5}[kind]]


def dns_checks(host, address, authorization):
    return {
        'address': dns_values(host, 'A') == [address] and not dns_values(host, 'AAAA'),
        'authorization': authorization['data'].rstrip('.') in dns_values(authorization['name'], 'CNAME'),
    }


def connected(shop):
    # urllib verifies both the hostname and trust chain; no unverified SSL context.
    try:
        with urllib.request.urlopen('https://' + shop['domain'] + '/.well-known/gemihub-domain', timeout=10) as response:
            return json.load(response) == {'shopId': shop['id'], 'domain': shop['domain']}
    except (OSError, ValueError):
        return False


def write_nginx(hosts, port):
    base = (ROOT / 'nginx-apps/gemihub-web.conf').read_text()
    static = set(re.search(r'server_name\s+([^;]+);', base).group(1).split())
    dynamic = sorted(set(hosts) - static)
    if not all(valid_host(host) for host in dynamic) or not isinstance(port, int) or not 8105 <= port <= 65535:
        raise ValueError('Invalid Nginx configuration')
    content = '# Managed by gemihub domain controller.\n'
    if dynamic:
        content += ('server {\n    listen 8080;\n    server_name ' + ' '.join(dynamic) + ';\n'
                    '    client_max_body_size 110m;\n    location / {\n'
                    '        proxy_pass http://127.0.0.1:' + str(port) + ';\n'
                    '        proxy_buffering off;\n    }\n}\n')
    path = ROOT / 'nginx-apps/gemihub-web-custom.conf'
    previous = path.read_text() if path.exists() else '# No custom storefront domains.\n'
    if content == previous:
        return
    pending = path.with_suffix('.pending')
    pending.write_text(content)
    pending.chmod(0o644)
    pending.replace(path)
    try:
        subprocess.run(['nginx', '-t'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        path.write_text(previous)
        raise


def reconcile(cloud):
    candidates = [shop for shop in cloud.shops() if eligible(shop)]
    # Never route ambiguous claims, even if the application data is malformed.
    counts = {}
    for shop in candidates:
        counts[shop['domain']] = counts.get(shop['domain'], 0) + 1
    active = []
    for shop in candidates:
        auth = None
        try:
            if counts[shop['domain']] != 1:
                raise ValueError('Duplicate domain claim')
            cert, auth = cloud.certificate(shop['domain'])
            dns = dns_checks(shop['domain'], cloud.config['address'], auth)
            if not all(dns.values()):
                cloud.status(shop, 'dns_required', auth, dns)
            elif cert.get('managed', {}).get('state') != 'ACTIVE':
                cloud.status(shop, 'certificate_pending', auth, dns)
            else:
                cloud.attach(shop['domain'], cert)
                active.append((shop, auth, dns))
        except Exception as error:
            cloud.status(shop, 'retrying', auth)
            print(json.dumps({'domain': shop['domain'], 'error': type(error).__name__, 'message': str(error)[:200], 'code': getattr(error, 'code', None)}), flush=True)
    # Keep already connected domains routed across temporary DNS/API failures.
    # Unverified, changed, archived and duplicate claims are always removed.
    previous = cloud.registry()
    eligible_hosts = {shop['domain'] for shop in candidates if counts[shop['domain']] == 1}
    hosts = (set(previous.get('hosts', [])) & eligible_hosts) | {shop['domain'] for shop, _, _ in active}
    cloud.routes(hosts)
    for shop, auth, dns in active:
        cloud.status(shop, 'connected' if connected(shop) else 'connecting', auth, dns)


def main():
    config = json.loads(Path('/etc/gemihub-domains.json').read_text())
    with open(ROOT / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cloud = Cloud(config)
        cloud.settings()
        reconcile(cloud)


if __name__ == '__main__':
    main()
