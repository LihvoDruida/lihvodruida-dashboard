import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeRaidPollCustomId,
  interactionDomainFor,
  isRaidPollPromptKind,
  validateInteractionComponents,
  INTERACTION_DOMAINS,
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

test("домени визначаються правильно", () => {
  assert.equal(interactionDomainFor(`mbv1:poll_role:${POLL}`), INTERACTION_DOMAINS.RAID_POLL);
  assert.equal(interactionDomainFor(`mbv1:raid:${POLL}:going`), INTERACTION_DOMAINS.RAID);
  assert.equal(interactionDomainFor(`mbv1:rss:${POLL}:going:key:dps`), INTERACTION_DOMAINS.RAID);
  assert.equal(interactionDomainFor(`mbv1:roster:${POLL}:publish`), INTERACTION_DOMAINS.ROSTER);
  assert.equal(interactionDomainFor("mbv1:rules:accept"), INTERACTION_DOMAINS.RULES);
  assert.equal(interactionDomainFor("something:else"), null);
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
