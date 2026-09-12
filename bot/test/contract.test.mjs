import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeRaidPollCustomId,
  interactionDomainFor,
  isRaidPollPromptKind,
  validateInteractionComponents,
  INTERACTION_DOMAINS,
  ROSTER_CUSTOM_ID_PATTERN,
  RULES_CUSTOM_ID_PATTERN,
} from "@mistblossom/discord-contract";

const POLL = "abc123def456ghi789";

test("розбирає всі дії рейд-пулу", () => {
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_vote_prompt:${POLL}`).kind, "vote_prompt");
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_submit:${POLL}`).kind, "submit");
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_schedule_page_1:${POLL}`).kind, "schedule_page");
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_role:${POLL}`, ["tank"]).kind, "role");
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_quick:${POLL}`, ["20:00"]).kind, "quick");
  const schedule = decodeRaidPollCustomId(`mbv1:poll_schedule_tue:${POLL}`, ["tue:20:00"]);
  assert.equal(schedule.kind, "schedule");
  assert.equal(schedule.group, "tue");
});

test("легасі custom_id далі відкривають пульт", () => {
  for (const legacy of ["character_prompt", "character"]) {
    const action = decodeRaidPollCustomId(`mbv1:poll_${legacy}:${POLL}`);
    assert.equal(action.kind, "vote_prompt", `${legacy} має відкривати пульт`);
    assert.ok(isRaidPollPromptKind(action.kind));
  }
});

test("select без значень відхиляється, кнопки — ні", () => {
  assert.equal(decodeRaidPollCustomId(`mbv1:poll_role:${POLL}`, []), null);
  assert.ok(decodeRaidPollCustomId(`mbv1:poll_submit:${POLL}`, []));
  assert.ok(decodeRaidPollCustomId(`mbv1:poll_vote_prompt:${POLL}`, []));
});

test("сміття не проходить", () => {
  assert.equal(decodeRaidPollCustomId("mbv1:poll_unknown:" + POLL), null);
  assert.equal(decodeRaidPollCustomId("mbv1:poll_role:short"), null);
  assert.equal(decodeRaidPollCustomId(""), null);
  assert.equal(decodeRaidPollCustomId(`evil:poll_role:${POLL}`, ["tank"]), null);
});

test("домени визначаються за реальними custom_id, які будує dashboard", () => {
  assert.equal(interactionDomainFor(`mbv1:poll_role:${POLL}`), INTERACTION_DOMAINS.RAID_POLL);
  assert.equal(interactionDomainFor(`mbv1:raid:${POLL}:going`), INTERACTION_DOMAINS.RAID);
  assert.equal(interactionDomainFor(`mbv1:rss:${POLL}:going:key:dps`), INTERACTION_DOMAINS.RAID);

  // rosterFormation.ts -> mbv1:roster_<action>:...
  assert.equal(interactionDomainFor(`mbv1:roster_pick:${POLL}`), INTERACTION_DOMAINS.ROSTER);
  assert.equal(interactionDomainFor(`mbv1:roster_class:${POLL}`), INTERACTION_DOMAINS.ROSTER);
  assert.equal(interactionDomainFor(`mbv1:roster_spec:${POLL}:druid`), INTERACTION_DOMAINS.ROSTER);
  assert.equal(interactionDomainFor(`mbv1:roster_leave:${POLL}`), INTERACTION_DOMAINS.ROSTER);

  // discordAdmin.ts uses compact rules IDs to stay under Discord's 100-char cap.
  assert.equal(interactionDomainFor("mbv1:a:abc.123"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("mbv1:c:a:abc.123"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("mbv1:d"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("mbv1:c:d"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("mbv1:r:s"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("mbv1:r:c:s"), INTERACTION_DOMAINS.RULES);

  assert.equal(interactionDomainFor("mbv1:danger"), null);
  assert.equal(interactionDomainFor("something:else"), null);
});

test("контракт приймає фактичні roster/rules custom_id", () => {
  for (const value of [
    `mbv1:roster_pick:${POLL}`,
    `mbv1:roster_class:${POLL}`,
    `mbv1:roster_spec:${POLL}:druid`,
    `mbv1:roster_leave:${POLL}`,
  ]) {
    assert.match(value, ROSTER_CUSTOM_ID_PATTERN);
  }
  for (const value of [
    "mbv1:a:abc.123",
    "mbv1:c:a:abc.123",
    "mbv1:d",
    "mbv1:c:d",
    "mbv1:r:s",
    "mbv1:r:c:s",
  ]) {
    assert.match(value, RULES_CUSTOM_ID_PATTERN);
  }
});

test("усі поточні raid custom_id доходять до raid domain", () => {
  for (const value of [
    `mbv1:raid:${POLL}:going`,
    `mbv1:rsc:${POLL}:going:dps`,
    `mbv1:rsr:${POLL}:going:char_key`,
    `mbv1:rss:${POLL}:going:char_key:dps`,
    `mbv1:rmc:${POLL}:going`,
    `mbv1:rms:${POLL}:going:druid`,
    `mbv1:rc:${POLL}:going`,
    `mbv1:rr:${POLL}:going:char_key`,
  ]) {
    assert.equal(interactionDomainFor(value), INTERACTION_DOMAINS.RAID, value);
  }
});

test("дублікат custom_id у наборі компонентів ловиться", () => {
  // Саме цей випадок ламав приватний пульт: при двох сторінках
  // «назад» і «вперед» вели на ту саму сторінку.
  const broken = [
    { components: [{ custom_id: `mbv1:poll_schedule_page_1:${POLL}` }] },
    { components: [
      { custom_id: `mbv1:poll_submit:${POLL}` },
      { custom_id: `mbv1:poll_schedule_page_1:${POLL}` },
    ] },
  ];
  const result = validateInteractionComponents(broken);
  assert.equal(result.ok, false);
  assert.equal(result.duplicates.length, 1);

  const fine = [
    { components: [{ custom_id: `mbv1:poll_role:${POLL}` }] },
    { components: [{ custom_id: `mbv1:poll_submit:${POLL}` }] },
  ];
  assert.equal(validateInteractionComponents(fine).ok, true);
});

test("більше пʼяти рядків — не ок", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ components: [{ custom_id: `mbv1:poll_role:${POLL}${i}` }] }));
  assert.equal(validateInteractionComponents(rows).ok, false);
});
