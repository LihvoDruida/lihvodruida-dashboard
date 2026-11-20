"""Tests for deploy/scripts/configure.py (run: python3 -m unittest deploy/scripts/test_configure.py)."""
import contextlib, importlib.util, io, os, shutil, stat, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('configure', SOURCE / 'deploy/scripts/configure.py')
configure = importlib.util.module_from_spec(spec)
sys.modules['configure'] = configure
spec.loader.exec_module(configure)

BOT_TOKEN = 'MTI' + 'x' * 69
PUBLIC_KEY = 'ab' * 32
SECRET_MARK = 'sekret-marker-value'


class ConfigureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='configure-')
        base = Path(self.temp.name)
        self.root = base / 'mistblossom'
        self.site = base / 'lihvodruida-site'
        for name in ['.env.example', 'dashboard/.env.example', 'bot/.env.example']:
            (self.root / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, self.root / name)
        self.site.mkdir()
        (self.site / 'compose.yml').write_text('services: {}\n')
        (self.site / '.env').write_text("SITE_URL=https://lihvodruida.pp.ua\nDASHBOARD_INTERNAL_URL=http://dashboard:3000\nPUBLIC_SITE_BRIDGE_TOKEN=\n# keep me\nCUSTOM=1\n")
        patches = {
            'ROOT': self.root,
            'FILES': {'root': self.root / '.env', 'dashboard': self.root / 'dashboard/.env.production', 'bot': self.root / 'bot/.env.production'},
            'TEMPLATES': {'root': self.root / '.env.example', 'dashboard': self.root / 'dashboard/.env.example', 'bot': self.root / 'bot/.env.example'},
            'BACKUPS': self.root / '.config-backups',
        }
        for name, value in patches.items():
            p = mock.patch.object(configure, name, value)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.temp.cleanup()

    def run_main(self, args, answers=(), secrets_in=()):
        out = io.StringIO()
        answers, secrets_in = iter(answers), iter(secrets_in)
        with mock.patch('builtins.input', lambda prompt='': next(answers, '')), \
             mock.patch.object(configure.getpass, 'getpass', lambda prompt='': next(secrets_in, '')), \
             mock.patch.object(sys.stdin, 'isatty', lambda: True), contextlib.redirect_stdout(out):
            code = configure.main(args + ['--site', str(self.site)])
        return code, out.getvalue()

    def env(self, rel):
        return configure.read_env(self.root / rel if rel != 'site' else self.site / '.env')

    def test_fresh_install_check_reports_required_values_and_writes_nothing(self):
        code, out = self.run_main(['--check'])
        self.assertEqual(code, 1)
        self.assertIn('DISCORD_BOT_TOKEN', out)
        self.assertIn('не задано', out)
        self.assertFalse((self.root / '.env').exists())

    def test_first_run_generates_secrets_builds_database_url_and_syncs_site(self):
        # Interactive answers in problem order; Enter generates secrets. Text prompts are input(), secrets getpass().
        text = {'DASHBOARD_PUBLIC_URL': 'https://guild.lihvodruida.pp.ua', 'PUBLIC_SITE_URL': 'https://lihvodruida.pp.ua',
                'DISCORD_GUILD_ID': '123456789012345678', 'DISCORD_APPLICATION_ID': '223456789012345678',
                'DISCORD_PUBLIC_KEY': PUBLIC_KEY, 'DISCORD_OAUTH_CLIENT_ID': '223456789012345678'}
        secret = {'DISCORD_BOT_TOKEN': BOT_TOKEN, 'DISCORD_OAUTH_CLIENT_SECRET': 'oauth-' + SECRET_MARK}

        def fake_input(prompt=''):
            for key, value in text.items():
                if current_key[0] == key:
                    return value
            return ''

        def fake_getpass(prompt=''):
            return secret.get(current_key[0], '')

        current_key = ['']
        real_ask = configure.ask

        def tracking_ask(s, current, allow_generate):
            current_key[0] = s.key
            return real_ask(s, current, allow_generate)

        out = io.StringIO()
        with mock.patch.object(configure, 'ask', tracking_ask), mock.patch('builtins.input', fake_input), \
             mock.patch.object(configure.getpass, 'getpass', fake_getpass), \
             mock.patch.object(sys.stdin, 'isatty', lambda: True), contextlib.redirect_stdout(out):
            code = configure.main(['--site', str(self.site)])
        output = out.getvalue()
        self.assertEqual(code, 0, output)
        root, dash, site = self.env('.env'), self.env('dashboard/.env.production'), self.env('site')
        self.assertEqual(len(root['INTERNAL_API_TOKEN']), 64)
        self.assertEqual(root['PUBLIC_SITE_BRIDGE_TOKEN'], site['PUBLIC_SITE_BRIDGE_TOKEN'])
        self.assertTrue(dash['DATABASE_URL'].startswith('postgresql://mistblossom:' + root['POSTGRES_PASSWORD'] + '@postgres:5432/'))
        self.assertGreaterEqual(len(dash['SESSION_SECRET']), 64)
        self.assertEqual(site['CUSTOM'], '1')
        self.assertIn('# keep me', (self.site / '.env').read_text())
        for path in [self.root / '.env', self.root / 'dashboard/.env.production', self.root / 'bot/.env.production', self.site / '.env']:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, path)
        for value in [root['INTERNAL_API_TOKEN'], dash['SESSION_SECRET'], BOT_TOKEN, SECRET_MARK, root['POSTGRES_PASSWORD']]:
            self.assertNotIn(value, output)
        self.assertTrue(any(self.root.joinpath('.config-backups').iterdir()))

    def configured(self):
        """A VPS-like configuration that passes, written through the module itself."""
        self.run_main(['--check'])
        for name in ['.env', 'dashboard/.env.production', 'bot/.env.production']:
            shutil.copyfile(self.root / (name.replace('.production', '.example') if 'production' in name else '.env.example'), self.root / name)
        stamp = 'test'
        pg = 'p' * 24
        configure.write_env(self.root / '.env', {'DASHBOARD_PUBLIC_URL': 'https://guild.lihvodruida.pp.ua', 'POSTGRES_PASSWORD': pg,
            'DISCORD_PUBLIC_KEY': PUBLIC_KEY, 'INTERNAL_API_TOKEN': 'i' * 40, 'DISCORD_BOT_TOKEN': BOT_TOKEN,
            'DISCORD_GUILD_ID': '123456789012345678', 'PUBLIC_SITE_BRIDGE_TOKEN': 'b' * 64, 'PUBLIC_SITE_URL': 'https://lihvodruida.pp.ua'}, stamp)
        configure.write_env(self.root / 'dashboard/.env.production', {'DATABASE_URL': f'postgresql://mistblossom:{pg}@postgres:5432/mistblossom',
            'SESSION_SECRET': 's' * 64, 'DISCORD_BOT_TOKEN': BOT_TOKEN, 'DISCORD_GUILD_ID': '123456789012345678',
            'DISCORD_OAUTH_CLIENT_ID': '223456789012345678', 'DISCORD_OAUTH_CLIENT_SECRET': 'o' * 32, 'PUBLIC_SITE_BRIDGE_TOKEN': 'b' * 64,
            'PUBLIC_SITE_URL': 'https://lihvodruida.pp.ua'}, stamp)
        configure.write_env(self.root / 'bot/.env.production', {'DISCORD_APPLICATION_ID': '223456789012345678'}, stamp)
        configure.write_env(self.site / '.env', {'PUBLIC_SITE_BRIDGE_TOKEN': 'b' * 64}, stamp)

    def test_working_configuration_passes_and_stale_mirror_is_only_a_warning(self):
        self.configured()
        code, out = self.run_main(['--check'])
        self.assertEqual(code, 0, out)
        configure.write_env(self.root / 'bot/.env.production', {'INTERNAL_API_TOKEN': 'old' * 10}, 'x')
        code, out = self.run_main(['--check'])
        self.assertEqual(code, 0, out)
        self.assertIn('⚠ INTERNAL_API_TOKEN', out)
        self.assertNotIn('old' * 10, out)

    def test_site_bridge_token_mismatch_fails_and_can_be_synced(self):
        self.configured()
        configure.write_env(self.site / '.env', {'PUBLIC_SITE_BRIDGE_TOKEN': 'c' * 64}, 'x')
        code, out = self.run_main(['--check'])
        self.assertEqual(code, 1)
        self.assertIn('різні значення у: site', out)
        code, out = self.run_main([], answers=['y', ''])
        self.assertEqual(code, 0, out)
        self.assertEqual(self.env('site')['PUBLIC_SITE_BRIDGE_TOKEN'], 'b' * 64)

    def test_first_launch_values_are_never_overwritten_by_the_wizard(self):
        self.configured()
        before = (self.root / '.env').read_text()
        with self.assertRaises(SystemExit):
            self.run_main(['--key', 'POSTGRES_PASSWORD'])
        self.assertEqual((self.root / '.env').read_text(), before)
        configure.write_env(self.root / '.env', {'POSTGRES_PASSWORD': 'q' * 24}, 'x')
        code, out = self.run_main(['--check'])
        self.assertEqual(code, 1)
        self.assertIn('не збігається з POSTGRES_PASSWORD', out)

    def test_values_with_shell_characters_are_quoted_and_round_trip(self):
        self.configured()
        key = '$2a$10$abcdefghijklmnopqrstuv'
        configure.write_env(self.site / '.env', {'CURSEFORGE_API_KEY': key}, 'x')
        self.assertIn(f"CURSEFORGE_API_KEY='{key}'", (self.site / '.env').read_text())
        self.assertEqual(self.env('site')['CURSEFORGE_API_KEY'], key)
        with self.assertRaises(ValueError):
            configure.render("bad'quote")

    def test_validation_rejects_placeholders_and_bad_formats(self):
        v = configure.validate
        self.assertIsNotNone(v(configure.BY_KEY['DASHBOARD_PUBLIC_URL'], 'http://guild.example'))
        self.assertIsNotNone(v(configure.BY_KEY['DISCORD_GUILD_ID'], '12345'))
        self.assertIsNotNone(v(configure.BY_KEY['DISCORD_PUBLIC_KEY'], 'zz' * 32))
        self.assertIsNotNone(v(configure.BY_KEY['SESSION_SECRET'], 'replace-me-with-a-long-secret-value-0000'))
        self.assertIsNone(v(configure.BY_KEY['DISCORD_PUBLIC_KEY'], PUBLIC_KEY))

    def test_backups_are_private_and_bounded(self):
        self.configured()
        for i in range(40):
            configure.write_env(self.root / '.env', {'LETSENCRYPT_EMAIL': f'a{i}@b.cd'}, f's{i:02d}')
        backups = list((self.root / '.config-backups').iterdir())
        self.assertLessEqual(len(backups), 30)
        self.assertTrue(all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in backups))
        self.assertEqual(stat.S_IMODE((self.root / '.config-backups').stat().st_mode), 0o700)


if __name__ == '__main__':
    unittest.main()
