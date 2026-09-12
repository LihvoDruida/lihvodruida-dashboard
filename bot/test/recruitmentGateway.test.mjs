import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeRecruitmentControl,
  getRecruitmentGatewayStatus,
  handleRecruitmentGatewayControl,
  stopRecruitmentGateway,
} from "../src/recruitmentGateway.mjs";

function fakeRequest(token, legacy = false) {
  return {
    headers: legacy
      ? { "x-worker-stats-token": token }
      : { authorization: `Bearer ${token}` },
  };
}

test("Recruitment Gateway control приймає тільки внутрішній секрет", () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "a".repeat(32);
  assert.equal(authorizeRecruitmentControl(fakeRequest("a".repeat(32))), true);
  assert.equal(authorizeRecruitmentControl(fakeRequest("a".repeat(32), true)), true);
  assert.equal(authorizeRecruitmentControl(fakeRequest("b".repeat(32))), false);
  assert.equal(authorizeRecruitmentControl({ headers: {} }), false);
  process.env.INTERNAL_API_TOKEN = previous;
});

test("status і stop не потребують Discord мережі", async () => {
  const stopped = stopRecruitmentGateway();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.connected, false);

  const status = await handleRecruitmentGatewayControl("status");
  assert.equal(status.enabled, false);
  assert.equal(status.connected, false);
  assert.equal(getRecruitmentGatewayStatus().enabled, false);
});

test("невідома control-дія повертає явну помилку", async () => {
  const result = await handleRecruitmentGatewayControl("does-not-exist");
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown action/);
});
