import unittest,tempfile,shutil,subprocess,json
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[2]
class EnvironmentTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'dashboard';self.site=Path(self.temp.name)/'site'
  (self.root/'deploy').mkdir(parents=True);(self.root/'dashboard').mkdir();self.site.mkdir()
  for name in ['prepare-unified-env.py','storage-env-map.json']:shutil.copyfile(SOURCE/'deploy'/name,self.root/'deploy'/name)
  (self.root/'.env').write_text('PUBLIC_SITE_BRIDGE_TOKEN=\nSESSION_SECRET=keep-session\n')
  (self.root/'dashboard/.env.production').write_text('DATABASE_URL=postgresql://keep\nFIREBASE_APPLICATIONS_COLLECTION=customApplications\nFIREBASE_PRIVATE_KEY="old\\nkey"\nGITHUB_TOKEN=retired\nSECRET=$(touch MUST_NOT_EXIST)\n')
  (self.site/'.env').write_text('SITE_URL=https://lihvodruida.pp.ua\nPUBLIC_SITE_BRIDGE_TOKEN=\n')
 def tearDown(self):self.temp.cleanup()
 def run_script(self):return subprocess.run(['python3',str(self.root/'deploy/prepare-unified-env.py'),'--site-dir',str(self.site)],capture_output=True,text=True)
 def test_migrates_settings_and_syncs_private_token_without_executing_values(self):
  r=self.run_script();self.assertEqual(r.returncode,0,r.stderr)
  files=[self.root/'.env',self.root/'dashboard/.env.production',self.site/'.env']
  tokens=[next(l for l in p.read_text().splitlines() if l.startswith('PUBLIC_SITE_BRIDGE_TOKEN=')) for p in files]
  self.assertEqual(len(set(tokens)),1);self.assertEqual(len(tokens[0].split('=')[1]),64)
  text=files[1].read_text();self.assertIn('STORAGE_APPLICATIONS_COLLECTION=customApplications',text);self.assertNotIn('FIREBASE_',text);self.assertNotIn('GITHUB_TOKEN',text);self.assertIn('DATABASE_URL=postgresql://keep',text)
  self.assertNotIn(tokens[0].split('=')[1],r.stdout+r.stderr)
  for p in files:self.assertEqual(p.stat().st_mode&0o777,0o600)
  self.assertFalse((self.root/'MUST_NOT_EXIST').exists())
  before=[p.read_text() for p in files];self.assertEqual(self.run_script().returncode,0);self.assertEqual([p.read_text() for p in files],before)
 def test_conflicting_tokens_do_not_rewrite_existing_files(self):
  (self.root/'.env').write_text('PUBLIC_SITE_BRIDGE_TOKEN='+'a'*64+'\n');(self.site/'.env').write_text('PUBLIC_SITE_BRIDGE_TOKEN='+'b'*64+'\n')
  before=(self.root/'.env').read_bytes();r=self.run_script();self.assertNotEqual(r.returncode,0);self.assertEqual((self.root/'.env').read_bytes(),before)
 def test_conflicting_renamed_settings_fail_before_write(self):
  p=self.root/'dashboard/.env.production';p.write_text('FIREBASE_READS_DISABLED=true\nSTORAGE_READS_DISABLED=false\n')
  before=p.read_bytes();self.assertNotEqual(self.run_script().returncode,0);self.assertEqual(p.read_bytes(),before)
if __name__=='__main__':unittest.main()
