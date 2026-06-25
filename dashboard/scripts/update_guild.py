from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests
import yaml

# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------
BLIZZARD_TOKEN_URL = "https://oauth.battle.net/token"
BLIZZARD_API_BASE = "https://{region}.api.blizzard.com"
RAIDER_IO_GUILD_API_URL = "https://raider.io/api/v1/guilds/profile"
RAIDER_IO_CHARACTER_API_URL = "https://raider.io/api/v1/characters/profile"

# Public project configuration. These values are not secrets.
WOW_REGION = "eu"
WOW_REALM = "terokkar"
WOW_GUILD_NAME = "Mistblossom Vanguard"
BLIZZARD_LOCALE = "en_US"
OUTPUT_GUILD_FILE = Path("_data/guild.yml")
OUTPUT_PROFESSIONS_FILE = Path("_data/professions.yml")

# Secrets / tunables.
BLIZZARD_CLIENT_ID = os.getenv("BLIZZARD_CLIENT_ID", "").strip()
BLIZZARD_CLIENT_SECRET = os.getenv("BLIZZARD_CLIENT_SECRET", "").strip()
RAIDERIO_ACCESS_KEY = os.getenv("RAIDERIO_ACCESS_KEY", "").strip()

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
REQUEST_DELAY_SECONDS = float(os.getenv("REQUEST_DELAY_SECONDS", "0.12"))

HEADERS = {"Accept": "application/json"}


@dataclass
class ApiContext:
    session: requests.Session
    blizzard_token: Optional[str] = None


# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------
def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    return session


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def slugify(value: str) -> str:
    slug = value.strip().lower()
    replacements = {
        "'": "",
        " ": "-",
        "_": "-",
        ".": "-",
    }
    for old, new in replacements.items():
        slug = slug.replace(old, new)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def encode_name(value: str) -> str:
    return quote(value.lower(), safe="")


def safe_get(session: requests.Session, url: str, **kwargs: Any) -> Optional[requests.Response]:
    try:
        return session.get(url, timeout=REQUEST_TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        print(f"❌ GET failed for {url}: {exc}")
        return None


def safe_post(url: str, **kwargs: Any) -> Optional[requests.Response]:
    try:
        return requests.post(url, timeout=REQUEST_TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        print(f"❌ POST failed for {url}: {exc}")
        return None


def round_item_level(value: Any) -> int:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0
    if numeric <= 0:
        return 0
    return int(numeric + 0.5)


# ------------------------------------------------------------
# BLIZZARD API
# ------------------------------------------------------------
def fetch_blizzard_access_token(ctx: ApiContext) -> Optional[str]:
    if ctx.blizzard_token:
        return ctx.blizzard_token

    if not BLIZZARD_CLIENT_ID or not BLIZZARD_CLIENT_SECRET:
        print("❌ Missing BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET")
        return None

    response = safe_post(
        BLIZZARD_TOKEN_URL,
        auth=(BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        headers={"Accept": "application/json"},
    )
    if not response:
        return None

    if response.status_code != 200:
        print(f"❌ Blizzard OAuth failed: {response.status_code} - {response.text}")
        return None

    payload = response.json()
    token = payload.get("access_token")
    if not token:
        print("❌ Blizzard OAuth response does not contain access_token")
        return None

    ctx.blizzard_token = token
    return token


def blizzard_get(
    ctx: ApiContext,
    path: str,
    namespace: str,
    *,
    region: Optional[str] = None,
    locale: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    token = fetch_blizzard_access_token(ctx)
    if not token:
        return None

    actual_region = (region or WOW_REGION).strip().lower()
    actual_locale = (locale or BLIZZARD_LOCALE).strip()

    url = BLIZZARD_API_BASE.format(region=actual_region) + path
    response = safe_get(
        ctx.session,
        url,
        params={
            "namespace": namespace,
            "locale": actual_locale,
        },
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    if not response:
        return None

    if response.status_code != 200:
        print(f"❌ Blizzard API error {response.status_code} for {path}: {response.text}")
        return None

    return response.json()


def fetch_guild_summary(ctx: ApiContext, realm_slug: str, guild_slug: str) -> Optional[Dict[str, Any]]:
    return blizzard_get(
        ctx,
        f"/data/wow/guild/{realm_slug}/{guild_slug}",
        namespace=f"profile-{WOW_REGION}",
    )


def fetch_guild_roster(ctx: ApiContext, realm_slug: str, guild_slug: str) -> Optional[Dict[str, Any]]:
    return blizzard_get(
        ctx,
        f"/data/wow/guild/{realm_slug}/{guild_slug}/roster",
        namespace=f"profile-{WOW_REGION}",
    )


def extract_profession_groups(payload: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {
        "primaries": [],
        "secondaries": [],
    }

    for group_name in ("primaries", "secondaries"):
        for entry in payload.get(group_name, []) or []:
            profession = entry.get("profession", {}) or {}
            tiers: List[Dict[str, Any]] = []
            for tier_entry in entry.get("tiers", []) or []:
                tier = tier_entry.get("tier", {}) or {}
                tiers.append(
                    {
                        "name": tier.get("name"),
                        "learned_points": tier_entry.get("skill_points", 0),
                        "max_points": tier_entry.get("max_skill_points", 0),
                    }
                )

            result[group_name].append(
                {
                    "name": profession.get("name"),
                    "id": profession.get("id"),
                    "tiers": tiers,
                }
            )

    return result


def fetch_character_professions(
    ctx: ApiContext,
    region: str,
    realm_slug: str,
    character_name: str,
) -> Dict[str, List[Dict[str, Any]]]:
    encoded_name = encode_name(character_name)
    payload = blizzard_get(
        ctx,
        f"/profile/wow/character/{realm_slug}/{encoded_name}/professions",
        namespace=f"profile-{region}",
        region=region,
    )
    if not payload:
        return {"primaries": [], "secondaries": []}
    return extract_profession_groups(payload)


# ------------------------------------------------------------
# RAIDER.IO API
# ------------------------------------------------------------
def fetch_raider_guild(
    region: str,
    realm_slug: str,
    guild_name: str,
    session: requests.Session,
) -> Optional[Dict[str, Any]]:
    params = {
        "region": region,
        "realm": realm_slug,
        "name": guild_name,
        "fields": ",".join([
            "raid_progression:current-expansion:previous-expansion",
            "raid_rankings:current-expansion:previous-expansion",
        ]),
    }
    if RAIDERIO_ACCESS_KEY:
        params["access_key"] = RAIDERIO_ACCESS_KEY

    response = safe_get(session, RAIDER_IO_GUILD_API_URL, params=params)
    if not response:
        return None

    if response.status_code != 200:
        print(f"⚠️ Raider.IO guild miss for {guild_name} ({realm_slug}): {response.status_code}")
        return None

    data = response.json()
    return {
        "profile_url": data.get("profile_url"),
        "last_crawled_at": data.get("last_crawled_at"),
        "raid_progression": data.get("raid_progression") or {},
        "raid_rankings": data.get("raid_rankings") or {},
    }


def fetch_raider_character(
    region: str,
    realm_slug: str,
    name: str,
    session: requests.Session,
) -> Optional[Dict[str, Any]]:
    params = {
        "region": region,
        "realm": realm_slug,
        "name": name,
        "fields": "gear,mythic_plus_scores_by_season:current",
    }
    if RAIDERIO_ACCESS_KEY:
        params["access_key"] = RAIDERIO_ACCESS_KEY

    response = safe_get(session, RAIDER_IO_CHARACTER_API_URL, params=params)
    if not response:
        return None

    if response.status_code != 200:
        print(f"   ⚠️ Raider.IO miss for {name} ({realm_slug}): {response.status_code}")
        return None

    data = response.json()
    segments: Dict[str, Any] = {}
    seasons = data.get("mythic_plus_scores_by_season", []) or []
    if seasons:
        segments = seasons[0].get("segments", {}) or {}

    mythic_plus_scores: Dict[str, Dict[str, Any]] = {}
    for segment_name, segment_data in segments.items():
        mythic_plus_scores[segment_name] = {
            "score": segment_data.get("score", 0),
            "color": segment_data.get("color", "#ffffff"),
        }

    return {
        "profile_url": data.get("profile_url"),
        "thumbnail_url": data.get("thumbnail_url"),
        "class_name": data.get("class"),
        "race_name": data.get("race"),
        "gender": data.get("gender"),
        "faction": data.get("faction"),
        "active_spec_name": data.get("active_spec_name"),
        "active_spec_role": data.get("active_spec_role"),
        "item_level_equipped": round_item_level(data.get("gear", {}).get("item_level_equipped")),
        "mythic_plus_scores": mythic_plus_scores,
    }


# ------------------------------------------------------------
# BUILD OUTPUT
# ------------------------------------------------------------
def build_outputs() -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    ctx = ApiContext(session=build_session())
    realm_slug = slugify(WOW_REALM)
    guild_slug = slugify(WOW_GUILD_NAME)

    print(f"🏰 Fetching Blizzard guild summary for {WOW_GUILD_NAME}...")
    guild_summary = fetch_guild_summary(ctx, realm_slug, guild_slug)

    print(f"👥 Fetching Blizzard guild roster for {WOW_GUILD_NAME}...")
    roster = fetch_guild_roster(ctx, realm_slug, guild_slug)
    if not roster:
        return None, None

    print(f"🔗 Fetching Raider.IO guild profile URL for {WOW_GUILD_NAME}...")
    raider_guild = fetch_raider_guild(WOW_REGION, realm_slug, WOW_GUILD_NAME, ctx.session)

    guild_block = roster.get("guild", {}) or {}
    guild_realm = guild_block.get("realm", {}) or {}
    guild_faction = guild_block.get("faction", {}) or {}

    processed_members: List[Dict[str, Any]] = []
    professions_characters: List[Dict[str, Any]] = []
    members = roster.get("members", []) or []

    print(f"👤 Found {len(members)} guild members. Enriching fields from Raider.IO and Blizzard professions...")

    for index, member in enumerate(members, start=1):
        character = member.get("character", {}) or {}
        realm = character.get("realm", {}) or {}
        faction = character.get("faction", {}) or {}

        character_name = character.get("name")
        if not character_name:
            continue

        character_realm_slug = realm.get("slug") or realm_slug
        character_region = WOW_REGION

        print(f"   [{index}/{len(members)}] {character_name}")
        raider = fetch_raider_character(character_region, character_realm_slug, character_name, ctx.session)
        professions = fetch_character_professions(ctx, character_region, character_realm_slug, character_name)

        profile_url = (raider or {}).get("profile_url")

        processed_members.append(
            {
                "rank": member.get("rank"),
                "character": {
                    "name": character_name,
                    "id": character.get("id"),
                    "level": character.get("level"),
                    "realm": {
                        "id": realm.get("id"),
                        "slug": realm.get("slug"),
                    },
                    "playable_class": {
                        "id": (character.get("playable_class") or {}).get("id"),
                        "name": (raider or {}).get("class_name"),
                    },
                    "playable_race": {
                        "id": (character.get("playable_race") or {}).get("id"),
                        "name": (raider or {}).get("race_name"),
                    },
                    "faction": {
                        "type": faction.get("type") or (raider or {}).get("faction"),
                    },
                    "gender": (raider or {}).get("gender"),
                    "active_spec": {
                        "name": (raider or {}).get("active_spec_name"),
                        "role": (raider or {}).get("active_spec_role"),
                    },
                    "avatar": (raider or {}).get("thumbnail_url"),
                    "profile_url": profile_url,
                    "item_level_equipped": (raider or {}).get("item_level_equipped", 0),
                    "mythic_plus_scores": (raider or {}).get("mythic_plus_scores", {}),
                    "sources": {
                        "roster": "blizzard",
                        "enrichment": "raider.io" if raider else None,
                        "professions": "blizzard",
                    },
                },
            }
        )

        professions_characters.append(
            {
                "name": character_name,
                "region": character_region,
                "realm": realm.get("slug") or WOW_REALM,
                "realm_slug": character_realm_slug,
                "profile_url": profile_url,
                "professions": professions,
            }
        )

        time.sleep(REQUEST_DELAY_SECONDS)

    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")

    guild_output = {
        "metadata": {
            "updated_at": timestamp,
            "source": "Blizzard Guild Roster API + Raider.IO Guild/Character API + Blizzard Professions API",
            "region": WOW_REGION,
            "locale": BLIZZARD_LOCALE,
            "raider_io_last_crawled_at": (raider_guild or {}).get("last_crawled_at"),
        },
        "guild": {
            "name": guild_block.get("name") or WOW_GUILD_NAME,
            "id": guild_block.get("id") or (guild_summary or {}).get("id"),
            "realm": {
                "name": guild_realm.get("name") or ((guild_summary or {}).get("realm") or {}).get("name") or WOW_REALM,
                "id": guild_realm.get("id") or ((guild_summary or {}).get("realm") or {}).get("id"),
                "slug": guild_realm.get("slug") or ((guild_summary or {}).get("realm") or {}).get("slug") or realm_slug,
            },
            "faction": {
                "type": guild_faction.get("type") or ((guild_summary or {}).get("faction") or {}).get("type"),
                "name": guild_faction.get("name") or ((guild_summary or {}).get("faction") or {}).get("name"),
            },
            "profile_url": (raider_guild or {}).get("profile_url"),
            "member_count": len(processed_members),
            "achievement_points": (guild_summary or {}).get("achievement_points"),
            "created_timestamp": (guild_summary or {}).get("created_timestamp"),
        },
        "raid_progression": (raider_guild or {}).get("raid_progression") or {},
        "raid_rankings": (raider_guild or {}).get("raid_rankings") or {},
        "members": processed_members,
    }

    professions_output = {
        "metadata": {
            "updated_at": timestamp,
            "source": "Blizzard Character Professions API",
            "region": WOW_REGION,
            "locale": BLIZZARD_LOCALE,
            "raider_io_last_crawled_at": (raider_guild or {}).get("last_crawled_at"),
        },
        "guild": {
            "name": guild_block.get("name") or WOW_GUILD_NAME,
            "id": guild_block.get("id") or (guild_summary or {}).get("id"),
            "realm": {
                "name": guild_realm.get("name") or ((guild_summary or {}).get("realm") or {}).get("name") or WOW_REALM,
                "id": guild_realm.get("id") or ((guild_summary or {}).get("realm") or {}).get("id"),
                "slug": guild_realm.get("slug") or ((guild_summary or {}).get("realm") or {}).get("slug") or realm_slug,
            },
            "faction": {
                "type": guild_faction.get("type") or ((guild_summary or {}).get("faction") or {}).get("type"),
                "name": guild_faction.get("name") or ((guild_summary or {}).get("faction") or {}).get("name"),
            },
            "profile_url": (raider_guild or {}).get("profile_url"),
            "member_count": len(professions_characters),
        },
        "characters": professions_characters,
    }

    return guild_output, professions_output


def write_yaml(path: Path, payload: Dict[str, Any]) -> None:
    ensure_parent_dir(path)
    with path.open("w", encoding="utf-8") as fh:
        yaml.dump(payload, fh, allow_unicode=True, sort_keys=False, width=120)
    print(f"✅ Saved: {path}")


def main() -> int:
    guild_output, professions_output = build_outputs()
    if not guild_output or not professions_output:
        print("❌ Failed to build guild/professions payloads")
        return 1

    try:
        write_yaml(OUTPUT_GUILD_FILE, guild_output)
        write_yaml(OUTPUT_PROFESSIONS_FILE, professions_output)
    except OSError as exc:
        print(f"❌ Failed to write YAML: {exc}")
        return 1

    print("🎉 Guild roster + professions export completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
