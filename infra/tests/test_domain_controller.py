import importlib.util
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('domain_controller', pathlib.Path(__file__).parents[1] / 'domain-controller.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def shop(**changes):
    return dict(id='shop', domain='reserve.example.com', domainToken='token', domainVerified=True, **changes)


class FakeCloud:
    config = {'address': '203.0.113.10', 'port': 8105}
    def __init__(self, shops, hosts=(), state='ACTIVE', fail=False):
        self.rows, self.hosts, self.state, self.fail = shops, list(hosts), state, fail
        self.events, self.statuses = [], []
    def shops(self): return self.rows
    def certificate(self, host):
        self.events.append(('certificate', host))
        if self.fail: raise OSError('Transient failure')
        return {'managed': {'state': self.state}}, {'name': '_acme.example.com.', 'type': 'CNAME', 'data': 'validation.example.'}
    def status(self, row, state, auth=None, dns=None): self.statuses.append((row['id'], state))
    def attach(self, host, cert): self.events.append(('attach', host))
    def registry(self): return {'hosts': self.hosts}
    def routes(self, hosts): self.hosts = sorted(hosts)


class Domains(unittest.TestCase):
    def test_validation_and_ownership(self):
        for host in ['valid.example.com', 'xn--sample.example']:
            self.assertTrue(m.valid_host(host))
        for host in ['bad;hostname.example', '*.example.com', '-bad.example', 'a' * 64 + '.example', 'http://example.com']:
            self.assertFalse(m.valid_host(host))
        self.assertFalse(m.eligible({**shop(), 'domainVerified': False}))
        self.assertFalse(m.eligible(shop(archivedAt='now')))
        self.assertFalse(m.eligible({**shop(), 'domain': 'kakeratta.net'}))
        self.assertFalse(m.eligible(shop(judge={'createdAt': 'now'})))

    @patch.object(m, 'dns_values')
    def test_dns_instructions_distinguish_address_and_certificate_records(self, values):
        auth = {'name': '_acme.example.com.', 'data': 'validation.example.'}
        values.side_effect = [['203.0.113.10'], [], []]
        self.assertEqual(m.dns_checks('reserve.example.com', '203.0.113.10', auth), {'address': True, 'authorization': False})
        values.side_effect = [['203.0.113.10'], ['2001:db8::1'], ['validation.example']]
        self.assertEqual(m.dns_checks('reserve.example.com', '203.0.113.10', auth), {'address': False, 'authorization': True})

    def test_project_number_certificate_references(self):
        cloud = m.Cloud.__new__(m.Cloud)
        cloud.config = {'map': 'shared-map'}
        host = 'reserve.example.com'
        name = m.resource_id(host)
        cloud.ensure = lambda *args: {'hostname': host, 'certificates': ['projects/123/locations/global/certificates/' + name]}
        cloud.attach(host, {'name': 'projects/project-id/locations/global/certificates/' + name})
        cloud.ensure = lambda *args: {'hostname': host, 'certificates': ['projects/123/locations/global/certificates/wrong']}
        with self.assertRaises(ValueError): cloud.attach(host, {'name': 'projects/project-id/locations/global/certificates/' + name})

    def test_routes_preserve_other_apps_and_remove_only_owned_hosts(self):
        mapping = {'hostRules': [
            {'pathMatcher': 'shared-kakeratta', 'hosts': ['kakeratta.net']},
            {'pathMatcher': 'shared-gemihub-web', 'hosts': ['gemihub.net', 'old.example.com']}], 'pathMatchers': ['untouched']}
        m.route_hosts(mapping, ['new.example.com'], ['old.example.com'])
        self.assertEqual(mapping['hostRules'][0]['hosts'], ['kakeratta.net'])
        self.assertEqual(mapping['hostRules'][1]['hosts'], ['gemihub.net', 'new.example.com'])
        self.assertEqual(mapping['pathMatchers'], ['untouched'])
        with self.assertRaises(ValueError): m.route_hosts(mapping, ['kakeratta.net'], [])

    @patch.object(m, 'connected', return_value=True)
    @patch.object(m, 'dns_checks', return_value={'address': True, 'authorization': True})
    def test_certificate_and_https_required(self, dns, probe):
        cloud = FakeCloud([shop()], state='PROVISIONING')
        m.reconcile(cloud)
        self.assertEqual(cloud.statuses, [('shop', 'certificate_pending')])
        self.assertEqual(cloud.hosts, [])
        probe.assert_not_called()
        cloud = FakeCloud([shop()])
        m.reconcile(cloud)
        self.assertEqual(cloud.hosts, ['reserve.example.com'])
        self.assertEqual(cloud.statuses, [('shop', 'connected')])
        probe.return_value = False
        cloud = FakeCloud([shop()])
        m.reconcile(cloud)
        self.assertEqual(cloud.statuses, [('shop', 'connecting')])

    @patch.object(m, 'dns_checks', return_value={'address': True, 'authorization': False})
    def test_dns_waits_and_temporary_failures_keep_existing_routes(self, dns):
        cloud = FakeCloud([shop()])
        m.reconcile(cloud)
        self.assertEqual(cloud.statuses, [('shop', 'dns_required')])
        self.assertEqual(cloud.hosts, [])
        cloud = FakeCloud([shop()], ['reserve.example.com'], fail=True)
        m.reconcile(cloud)
        self.assertEqual(cloud.hosts, ['reserve.example.com'])
        self.assertEqual(cloud.statuses, [('shop', 'retrying')])

    def test_unverified_archived_and_duplicate_claims_are_not_routed(self):
        for rows in [[{**shop(), 'domainVerified': False}], [shop(archivedAt='now')], [shop(), {**shop(), 'id': 'duplicate'}]]:
            cloud = FakeCloud(rows, ['reserve.example.com'])
            m.reconcile(cloud)
            self.assertEqual(cloud.hosts, [])
            self.assertFalse(any(event[0] == 'attach' for event in cloud.events))


if __name__ == '__main__': unittest.main()
