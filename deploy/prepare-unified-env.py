#!/usr/bin/env python3
"""Prepare the paired deployment configuration; never print secret values."""
import argparse,json,re,secrets,shutil,datetime
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--site-dir',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
site=args.site_dir.resolve()
paths=[root/'.env',root/'dashboard/.env.production',site/'.env']
for p,example in [(paths[0],root/'.env.example'),(paths[1],root/'dashboard/.env.example'),(paths[2],site/'.env.example')]:
    if not p.exists():shutil.copyfile(example,p);p.chmod(0o600)
def read(p):
    values={}
    for line in p.read_text().splitlines():
        match=re.match(r'^([A-Z][A-Z0-9_]*)=(.*)$',line)
        if match:values[match[1]]=match[2].strip().strip('"\'')
    return values
values=[read(p) for p in paths]
tokens=[v.get('PUBLIC_SITE_BRIDGE_TOKEN','') for v in values if v.get('PUBLIC_SITE_BRIDGE_TOKEN','')]
if len(set(tokens))>1:raise SystemExit('Different bridge tokens exist. Set one identical token in both root .env and site .env, then retry.')
token=tokens[0] if tokens else secrets.token_hex(32)
if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}',token):raise SystemExit('Invalid bridge token. Use 32–256 URL-safe characters.')
mapping=json.loads((root/'deploy/storage-env-map.json').read_text())
removed={'FIREBASE_PROJECT_ID','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY','GITHUB_OWNER','GITHUB_REPO','GITHUB_TOKEN','GUILD_APPLICATIONS_LABEL','RAID_IMAGES_BRANCH','RAID_IMAGES_DIRECTORY','RAID_IMAGES_PUBLIC_BASE_URL','DISCORD_INTERACTION_REQUIRE_POSTGRES','GUILD_ROSTER_READ_LEGACY_MEMBER_DOCS','GUILD_ROSTER_WRITE_LEGACY_MEMBER_DOCS','GITHUB_CONTENT_BRANCH','GITHUB_STATUS_CLEANUP_CONCURRENCY','FIREBASE_APPLICATIONS_LIST_LIMIT','STORAGE_APPLICATIONS_LIST_LIMIT'}
mapping={k:v for k,v in mapping.items() if k not in removed}
mapping['GUILD_APPLICATIONS_FIREBASE_COLLECTION']='STORAGE_APPLICATIONS_COLLECTION'
updates=[{'PUBLIC_SITE_BRIDGE_TOKEN':token},{'PUBLIC_SITE_BRIDGE_TOKEN':token},{'PUBLIC_SITE_BRIDGE_TOKEN':token,'DASHBOARD_INTERNAL_URL':'http://dashboard:3000',**({'CURSEFORGE_API_KEY':values[2]['CURSEFORGE_API_KEY']} if values[2].get('CURSEFORGE_API_KEY') else {})}]
# Produce every transformed file before writing any existing one.
prepared=[]
for p,old,extra in zip(paths,values,updates):
    migrated={}
    for key,new in mapping.items():
        if key not in old:continue
        val=old[key]
        if new in old and old[new]!=val:raise SystemExit(f'Conflicting setting {key}/{new} in {p}; resolve before retrying.')
        if new in migrated and migrated[new]!=val:raise SystemExit(f'Conflicting retired settings for {new} in {p}; resolve before retrying.')
        migrated[new]=val
    lines=[];skip_quote=None
    for line in p.read_text().splitlines():
        if skip_quote:
            if line.rstrip().endswith(skip_quote):skip_quote=None
            continue
        match=re.match(r'^([A-Z][A-Z0-9_]*)=(.*)$',line)
        if match and match[1] in removed:
            raw=match[2].strip()
            if raw[:1] in ('"',"'") and (len(raw)==1 or not raw.endswith(raw[0])):skip_quote=raw[0]
            continue
        if match and match[1] in mapping:continue
        if match and match[1] in extra:continue
        lines.append(line)
    for key,val in {**migrated,**extra}.items():
        if key in old and key not in extra:continue
        
        if key=='CURSEFORGE_API_KEY':
            if any(c in val for c in ["'",'\n','\r']):raise SystemExit('Invalid CurseForge key format; no files were written.')
            lines.append(f"{key}='{val}'")
        else:lines.append(f'{key}={val}')
    prepared.append('\n'.join(lines).rstrip()+'\n')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
for p,text in zip(paths,prepared):
    backup=p.with_name(p.name+'.before-3.9.1-'+stamp)
    shutil.copyfile(p,backup);backup.chmod(0o600)
    temp=p.with_name(p.name+'.unified-tmp');temp.write_text(text);temp.chmod(0o600);temp.replace(p)
print('Paired configuration prepared. Secret values were not printed. Protected backups were created beside each environment file.')
