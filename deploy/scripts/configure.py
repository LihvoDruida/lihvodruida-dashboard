#!/usr/bin/env python3
"""Interactive, safe configuration of the dashboard, bot and public site .env files.

    make configure                 walk through missing/invalid values, then optional edits
    make configure KEY=NAME        set one value (hidden input for secrets)
    make configure-check           read-only status; exit 1 when something must be fixed

Rules: secret values are never printed or logged; shared values (bridge token, internal
token, Discord keys) are written to every file that needs them; every write is atomic,
0600, preceded by a 0600 backup; unknown lines and comments are preserved; values that
must not change after the first launch (database password, profile ID secret, application
number salt) are only ever generated when empty.
"""
from __future__ import annotations

import argparse, datetime, getpass, os, re, secrets, shutil, sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FILES = {'root': ROOT / '.env', 'dashboard': ROOT / 'dashboard/.env.production', 'bot': ROOT / 'bot/.env.production'}
TEMPLATES = {'root': ROOT / '.env.example', 'dashboard': ROOT / 'dashboard/.env.example', 'bot': ROOT / 'bot/.env.example'}
BACKUPS = ROOT / '.config-backups'
LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')
SAFE_UNQUOTED = re.compile(r'^[A-Za-z0-9_./:@,+=-]*$')


@dataclass(frozen=True)
class Setting:
    key: str
    files: tuple[str, ...]      # authoritative files: required and written
    group: str
    help: str
    kind: str = 'text'          # text | secret | url | https | snowflake | hex64 | email | digits | choice | bool
    required: bool = False
    generate: int = 0           # bytes of entropy for an auto-generated secret (hex), 0 = never
    min_len: int = 0
    immutable: bool = False     # never change an existing value from the wizard
    choices: tuple[str, ...] = ()
    pattern: str = ''
    mirrors: tuple[str, ...] = ()  # files Compose overrides from the root .env; a stale copy there is only a warning


S = Setting
SCHEMA: list[Setting] = [
    # --- Адреси ---------------------------------------------------------------
    S('DASHBOARD_PUBLIC_URL', ('root',), 'Адреси', 'Публічна адреса панелі (Cloudflare → VPS).', 'https', required=True),
    S('PUBLIC_SITE_URL', ('root',), 'Адреси', 'Публічна адреса сайту lihvodruida.pp.ua.', 'https', required=True, mirrors=('dashboard',)),
    S('LETSENCRYPT_EMAIL', ('root',), 'Адреси', 'Email для сповіщень Let\'s Encrypt (необовʼязково з Cloudflare Origin).', 'email'),
    # --- Discord ----------------------------------------------------------------
    S('DISCORD_GUILD_ID', ('root', 'dashboard'), 'Discord', 'ID Discord-сервера гільдії.', 'snowflake', required=True),
    S('DISCORD_APPLICATION_ID', ('bot',), 'Discord', 'Application ID бота (Developer Portal → General).', 'snowflake', required=True, mirrors=('dashboard',)),
    S('DISCORD_PUBLIC_KEY', ('root',), 'Discord', 'Public Key застосунку (64 hex-символи).', 'hex64', required=True, mirrors=('dashboard', 'bot')),
    S('DISCORD_BOT_TOKEN', ('root', 'dashboard'), 'Discord', 'Токен бота (Developer Portal → Bot → Reset Token).', 'secret', required=True, min_len=50),
    S('DISCORD_OAUTH_CLIENT_ID', ('dashboard',), 'Discord', 'OAuth2 Client ID для входу в панель (зазвичай = Application ID).', 'snowflake', required=True),
    S('DISCORD_OAUTH_CLIENT_SECRET', ('dashboard',), 'Discord', 'OAuth2 Client Secret для входу в панель.', 'secret', required=True, min_len=16),
    # --- Внутрішні секрети ------------------------------------------------------
    S('INTERNAL_API_TOKEN', ('root',), 'Внутрішні секрети', 'Токен між панеллю, ботом і cron.', 'secret', required=True, generate=32, min_len=24, mirrors=('dashboard', 'bot')),
    S('PUBLIC_SITE_BRIDGE_TOKEN', ('root', 'site'), 'Внутрішні секрети', 'Спільний токен панелі й публічного сайту.', 'secret', required=True, generate=32, min_len=32, pattern=r'[A-Za-z0-9_-]{32,256}', mirrors=('dashboard',)),
    S('SESSION_SECRET', ('dashboard',), 'Внутрішні секрети', 'Підпис сесій панелі. Зміна розлогінить усіх.', 'secret', required=True, generate=32, min_len=32),
    S('DASHBOARD_RULES_TOKEN_SECRET', ('dashboard',), 'Внутрішні секрети', 'Підпис посилань на прийняття правил.', 'secret', generate=32, min_len=32),
    S('INTERNAL_PROFILE_LOOKUP_TOKEN', ('dashboard',), 'Внутрішні секрети', 'Токен внутрішнього пошуку профілів.', 'secret', generate=32, min_len=24),
    S('RAID_LIFECYCLE_SECRET', ('dashboard',), 'Внутрішні секрети', 'Токен cron для життєвого циклу рейдів.', 'secret', generate=32, min_len=24),
    S('PROFILE_REFRESH_SECRET', ('dashboard',), 'Внутрішні секрети', 'Токен cron для оновлення профілів.', 'secret', generate=32, min_len=24),
    S('ADMIN_DASHBOARD_TOKEN', ('dashboard',), 'Внутрішні секрети', 'Аварійний вхід власника; залиште порожнім, якщо не потрібен.', 'secret', min_len=32),
    # --- Значення першого запуску (не змінювати) --------------------------------
    S('POSTGRES_PASSWORD', ('root',), 'База даних', 'Пароль PostgreSQL. Після першого запуску змінюється лише разом з роллю в базі.', 'secret', required=True, generate=24, min_len=16, immutable=True),
    S('DATABASE_URL', ('dashboard',), 'База даних', 'Рядок підключення панелі; пароль має збігатися з POSTGRES_PASSWORD.', 'secret', required=True, immutable=True),
    S('PROFILE_ID_SECRET', ('dashboard',), 'База даних', 'Сіль ідентифікаторів профілів. Зміна перенумерує профілі.', 'secret', immutable=True),
    S('APPLICATION_NUMBER_DATE_SALT', ('dashboard',), 'База даних', 'Сіль номерів заявок. Зміна змінить нумерацію.', 'digits', immutable=True),
    # --- Безпека ----------------------------------------------------------------
    S('SECURITY_REQUIRE_CLOUDFLARE', ('root',), 'Безпека', 'Пускати трафік лише через Cloudflare.', 'choice', choices=('strict',)),
    S('SECURITY_STRICT_ORIGIN_CHECKS', ('root',), 'Безпека', 'Перевірка Origin/Referer для змін (CSRF).', 'bool'),
    # --- Інтеграції -------------------------------------------------------------
    S('BATTLENET_CLIENT_ID', ('dashboard',), 'Інтеграції', 'Battle.net API Client ID (персонажі, склад).', 'text'),
    S('BATTLENET_CLIENT_SECRET', ('dashboard',), 'Інтеграції', 'Battle.net API Client Secret.', 'secret', min_len=16),
    S('RAIDERIO_ACCESS_KEY', ('dashboard',), 'Інтеграції', 'Ключ Raider.IO (необовʼязково; підвищує ліміти).', 'secret'),
    # --- Публічний сайт ---------------------------------------------------------
    S('SITE_URL', ('site',), 'Сайт', 'Публічна адреса сайту.', 'https', required=True),
    S('DASHBOARD_INTERNAL_URL', ('site',), 'Сайт', 'Внутрішня адреса панелі в мережі Docker.', 'choice', required=True, choices=('http://dashboard:3000',)),
    S('CURSEFORGE_API_KEY', ('site',), 'Сайт', 'Ключ CurseForge API для сторінки адонів.', 'secret', min_len=16, pattern=r'[A-Za-z0-9$./_+=-]{16,256}'),
    S('CURSEFORGE_AUTHOR_ID', ('site',), 'Сайт', 'ID автора на CurseForge.', 'digits'),
    S('GOOGLE_SITE_VERIFICATION', ('site',), 'Сайт', 'Код підтвердження Google Search Console.', 'text'),
    S('BING_SITE_VERIFICATION', ('site',), 'Сайт', 'Код підтвердження Bing Webmaster.', 'text'),
]
BY_KEY = {s.key: s for s in SCHEMA}


# ----------------------------------------------------------------------------- env files
def unquote(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        return v[1:-1]
    return v


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            m = LINE.match(line)
            if m and not line.lstrip().startswith('#'):
                values[m.group(1)] = unquote(m.group(2))
    return values


def render(value: str) -> str:
    if '\n' in value or '\r' in value or "'" in value:
        raise ValueError('значення не може містити переносів рядка або одинарних лапок')
    return value if SAFE_UNQUOTED.match(value) else f"'{value}'"


def write_env(path: Path, updates: dict[str, str], backup_stamp: str) -> None:
    """Replace the last assignment of each key in place (append unknown keys); atomic, 0600."""
    text = path.read_text(encoding='utf-8') if path.exists() else ''
    lines = text.splitlines()
    pending = dict(updates)
    last_index: dict[str, int] = {}
    for i, line in enumerate(lines):
        m = LINE.match(line)
        if m and not line.lstrip().startswith('#') and m.group(1) in pending:
            last_index[m.group(1)] = i
    for key, i in last_index.items():
        lines[i] = f'{key}={render(pending.pop(key))}'
    if pending:
        lines += ['', '# Додано через make configure'] + [f'{k}={render(v)}' for k, v in pending.items()]
    if path.exists():
        BACKUPS.mkdir(mode=0o700, exist_ok=True)
        backup = BACKUPS / f'{path.name}.{path.parent.name}.{backup_stamp}'
        shutil.copyfile(path, backup)
        backup.chmod(0o600)
        prune_backups()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.configure-tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines).rstrip('\n') + '\n')
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def prune_backups(keep: int = 30) -> None:
    files = sorted(BACKUPS.glob('*'), key=lambda p: p.stat().st_mtime)
    for old in files[:-keep]:
        old.unlink(missing_ok=True)


# ----------------------------------------------------------------------------- validation
def validate(s: Setting, value: str) -> str | None:
    """Problem description for a non-empty value, or None when it is valid."""
    if s.kind in ('url', 'https'):
        parts = urlsplit(value)
        if parts.scheme not in (('https',) if s.kind == 'https' else ('http', 'https')) or not parts.netloc:
            return 'має бути адресою, що починається з https://' if s.kind == 'https' else 'має бути http(s)-адресою'
    if s.kind == 'snowflake' and not re.fullmatch(r'\d{17,20}', value):
        return 'має бути Discord ID із 17–20 цифр'
    if s.kind == 'hex64' and not re.fullmatch(r'[0-9A-Fa-f]{64}', value):
        return 'має бути рівно 64 hex-символи'
    if s.kind == 'email' and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
        return 'має бути email-адресою'
    if s.kind == 'digits' and not re.fullmatch(r'\d{1,20}', value):
        return 'має складатися лише з цифр'
    if s.kind == 'bool' and value.lower() not in ('1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'):
        return 'має бути true або false'
    if s.kind == 'choice' and value not in s.choices:
        return 'допустимо: ' + ', '.join(s.choices)
    if s.min_len and len(value) < s.min_len:
        return f'закоротке: потрібно щонайменше {s.min_len} символів'
    if s.pattern and not re.fullmatch(s.pattern, value):
        return 'має недопустимі символи або довжину'
    if is_placeholder(value):
        return 'схоже на заглушку з шаблону'
    return None


def is_placeholder(value: str) -> bool:
    return bool(re.search(r'^(replace|change|your[_ -]|<)|пароль|example', value, re.I))


@dataclass
class State:
    paths: dict[str, Path]
    values: dict[str, dict[str, str]] = field(default_factory=dict)

    @classmethod
    def load(cls, site: Path | None) -> 'State':
        paths = dict(FILES)
        if site:
            paths['site'] = site / '.env'
        return cls(paths, {name: read_env(p) for name, p in paths.items()})

    def files_for(self, s: Setting) -> list[str]:
        return [f for f in s.files if f in self.paths]

    def stale_mirrors(self, s: Setting, canonical: str) -> list[str]:
        return [f for f in s.mirrors if f in self.paths and self.values[f].get(s.key) and self.values[f][s.key] != canonical]

    def current(self, s: Setting) -> tuple[str, list[str]]:
        """Canonical value (first file that has one) and the files whose value differs."""
        present = [(f, self.values[f].get(s.key, '')) for f in self.files_for(s)]
        canonical = next((v for _, v in present if v), '')
        mismatched = [f for f, v in present if v and v != canonical]
        return canonical, mismatched


def db_password(url: str) -> str | None:
    try:
        return urlsplit(url).password
    except ValueError:
        return None


def db_url_placeholder(url: str) -> bool:
    """True for an empty value or the template's `postgresql://user:пароль@…` line."""
    pw = db_password(url) if url else None
    return not url or not pw or bool(re.search(r'пароль|password|change|replace', pw, re.I))


def warnings(state: State) -> list[tuple[Setting, str]]:
    found = []
    for s in SCHEMA:
        value, _ = state.current(s)
        stale = state.stale_mirrors(s, value) if value else []
        if stale:
            found.append((s, 'застаріла копія у ' + ', '.join(stale) + ' (Compose бере значення з кореневого .env)'))
    return found


def problems(state: State) -> list[tuple[Setting, str]]:
    found: list[tuple[Setting, str]] = []
    for s in SCHEMA:
        if not state.files_for(s):
            continue
        value, mismatched = state.current(s)
        if not value:
            if s.required:
                found.append((s, 'не задано'))
            continue
        issue = validate(s, value) if s.key != 'DATABASE_URL' else None
        if issue:
            found.append((s, issue))
        if mismatched:
            found.append((s, 'різні значення у: ' + ', '.join(mismatched)))
        missing_in = [f for f in state.files_for(s) if not state.values[f].get(s.key)]
        if missing_in and s.required:
            found.append((s, 'відсутнє у: ' + ', '.join(missing_in)))
    pg, url = state.current(BY_KEY['POSTGRES_PASSWORD'])[0], state.current(BY_KEY['DATABASE_URL'])[0]
    if url and db_url_placeholder(url):
        found.append((BY_KEY['DATABASE_URL'], 'містить заглушку пароля з шаблону'))
    elif pg and url and db_password(url) != pg:
        found.append((BY_KEY['DATABASE_URL'], 'пароль у DATABASE_URL не збігається з POSTGRES_PASSWORD'))
    return found


def describe(s: Setting, value: str) -> str:
    if not value:
        return '—'
    if s.kind == 'secret':
        return f'задано ({len(value)} симв.)'
    return value


def status(state: State) -> int:
    issues, notes = problems(state), warnings(state)
    by_key: dict[str, list[str]] = {}
    for s, msg in issues:
        by_key.setdefault(s.key, []).append(msg)
    warn_key: dict[str, list[str]] = {}
    for s, msg in notes:
        warn_key.setdefault(s.key, []).append(msg)
    group = None
    for s in SCHEMA:
        if not state.files_for(s):
            continue
        if s.group != group:
            group = s.group
            print(f'\n==> {group}')
        value, _ = state.current(s)
        mark = '✗' if s.key in by_key else ('⚠' if s.key in warn_key else ('·' if not value else '✓'))
        note = '; '.join(by_key.get(s.key, []) + warn_key.get(s.key, []))
        print(f'  {mark} {s.key:<31} {describe(s, value)}' + (f'  ← {note}' if note else ''))
    files = ', '.join(f'{n}: {p}' for n, p in state.paths.items())
    print(f'\nФайли: {files}')
    if issues:
        print(f'\n{len(issues)} проблем(и). Виправлення: make configure')
        return 1
    print('\nУсе налаштовано.')
    return 0


# ----------------------------------------------------------------------------- interactive
def ask(s: Setting, current: str, allow_generate: bool) -> str | None:
    """Prompt for a value; None keeps the current one."""
    print(f'\n{s.key} — {s.help}')
    if current:
        print(f'  Зараз: {describe(s, current)}')
    if s.choices:
        print('  Допустимо: ' + ', '.join(s.choices))
    hint = ' (Enter — згенерувати)' if allow_generate else (' (Enter — залишити)' if current else ' (Enter — пропустити)')
    while True:
        raw = (getpass.getpass(f'  Нове значення{hint}: ') if s.kind == 'secret' else input(f'  Нове значення{hint}: ')).strip()
        if not raw:
            return secrets.token_hex(s.generate) if allow_generate else None
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in '"\'':
            raw = raw[1:-1]
        issue = validate(s, raw)
        if issue:
            print(f'  ✗ {issue}. Спробуйте ще раз або натисніть Enter.')
            continue
        try:
            render(raw)
        except ValueError as error:
            print(f'  ✗ {error}.')
            continue
        return raw


def apply(state: State, changes: dict[str, str]) -> None:
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    per_file: dict[str, dict[str, str]] = {}
    for key, value in changes.items():
        s = BY_KEY[key]
        targets = state.files_for(s) + [f for f in s.mirrors if f in state.paths and state.values[f].get(key)]
        for f in targets:
            per_file.setdefault(f, {})[key] = value
    for f, updates in per_file.items():
        write_env(state.paths[f], updates, stamp)
        state.values[f].update(updates)
        print(f'  ✓ {state.paths[f]}: оновлено {", ".join(sorted(updates))}')


def fix_interactively(state: State) -> dict[str, str]:
    changes: dict[str, str] = {}
    for s, msg in warnings(state):
        print(f'\n⚠ {s.key}: {msg}.')
        if input('  Оновити копію до канонічного значення? [Y/n]: ').strip().lower() in ('', 'y', 'т', 'так'):
            changes[s.key] = state.current(s)[0]
    for s, msg in problems(state):
        if s.key in changes:
            continue
        value, mismatched = state.current(s)
        if s.key == 'DATABASE_URL':
            fresh_pg = changes.get('POSTGRES_PASSWORD', '')
            pg = fresh_pg or state.current(BY_KEY['POSTGRES_PASSWORD'])[0]
            # Compose the URL only for a first launch: empty/template value, or a database password
            # generated in this same run. An existing real URL is never rewritten.
            if pg and (db_url_placeholder(value) or fresh_pg):
                user = state.values['root'].get('POSTGRES_USER', 'mistblossom')
                db = state.values['root'].get('POSTGRES_DB', 'mistblossom')
                changes['DATABASE_URL'] = f'postgresql://{user}:{pg}@postgres:5432/{db}'
                print('\nDATABASE_URL складено з POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB.')
            else:
                print(f'\n⚠ DATABASE_URL: {msg}. Змініть пароль ролі в PostgreSQL і обидва значення вручну; майстер їх не перезаписує.')
            continue
        if value and mismatched and not validate(s, value):
            print(f'\n{s.key}: {msg}. Канонічне значення — з першого файла ({state.files_for(s)[0]}).')
            if input('  Синхронізувати в усі файли? [Y/n]: ').strip().lower() in ('', 'y', 'т', 'так'):
                changes[s.key] = value
            continue
        blank = not value or is_placeholder(value)
        if s.immutable and not blank:
            print(f'\n⚠ {s.key}: {msg}. Це значення першого запуску — майстер його не змінює.')
            continue
        new = ask(s, value, allow_generate=bool(s.generate) and blank)
        if new is not None:
            changes[s.key] = new
        elif value and s.key in [x.key for x, _ in problems(state)] and s.required:
            print('  ⚠ залишено без змін — make configure-check і далі показуватиме проблему.')
    return changes


def edit_one(state: State, key: str) -> dict[str, str]:
    s = BY_KEY.get(key)
    if not s:
        raise SystemExit(f'Невідомий параметр {key}. Доступні: {", ".join(BY_KEY)}')
    if not state.files_for(s):
        raise SystemExit(f'{key} зберігається у файлі сайту: додайте SITE=/srv/lihvodruida-site.')
    value, _ = state.current(s)
    if s.immutable and value and not is_placeholder(value):
        raise SystemExit(f'{key} — значення першого запуску; змінюйте вручну разом із даними (див. опис у make configure-check).')
    new = ask(s, value, allow_generate=bool(s.generate))
    return {key: new} if new is not None else {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='лише показати стан, нічого не змінювати')
    parser.add_argument('--key', help='змінити одне значення')
    parser.add_argument('--site', help='каталог публічного сайту (за замовчуванням ../lihvodruida-site, якщо є)')
    args = parser.parse_args(argv)
    site = Path(args.site) if args.site else (ROOT.parent / 'lihvodruida-site')
    if not (site / 'compose.yml').exists() and not (site / '.env').exists():
        if args.site:
            raise SystemExit(f'Каталог сайту не знайдено: {site}')
        site = None
    for name, path in FILES.items():
        if not path.exists() and TEMPLATES[name].exists() and not args.check:
            shutil.copyfile(TEMPLATES[name], path)
            path.chmod(0o600)
            print(f'Створено {path} із шаблону.')
    state = State.load(site)
    if args.check:
        return status(state)
    if not sys.stdin.isatty():
        raise SystemExit('make configure інтерактивний; для перевірки без змін: make configure-check')
    changes = edit_one(state, args.key) if args.key else fix_interactively(state)
    while not args.key:
        key = input('\nЗмінити ще щось? Назва параметра (Enter — завершити, ? — список): ').strip().upper()
        if not key:
            break
        if key == '?':
            print(', '.join(s.key for s in SCHEMA if state.files_for(s)))
            continue
        try:
            changes.update(edit_one(state, key))
        except SystemExit as error:
            print(f'  ✗ {error}')
    if changes:
        print()
        apply(state, changes)
        print('\nЗастосування: make up (панель і бот), а для сайту — make deploy у його каталозі.')
    print()
    return status(state)


if __name__ == '__main__':
    sys.exit(main())
