import type { ProfileCharacter } from "@/lib/profiles";
import { wowRoleLabel } from "@/lib/wowRoles";
import { pickWowAvatarImageUrl } from "@/lib/wowCharacters";

function candidateAuxMeta(
  character: Pick<ProfileCharacter, "level" | "raceName" | "faction">,
) {
  return [
    typeof character.level === "number" ? `Lvl ${character.level}` : null,
    character.raceName || null,
    character.faction || null,
  ].filter(Boolean);
}

export default function ProfileCandidateCharacterRow({
  character,
  bulkFormId,
}: {
  character: ProfileCharacter;
  bulkFormId: string;
}) {
  const kindLabel = character.verifiedGuild ? "🌿 Гільдійний" : "🤝 Інший";
  const image = pickWowAvatarImageUrl(
    character.avatarUrl,
    character.renderUrl,
    character.mediaUrl,
  );
  const realmLabel = character.realmName || character.realmSlug || "Реалм —";
  const extraMeta = candidateAuxMeta(character);

  return (
    <li
      className={`profile-character-candidate${character.verifiedGuild ? " is-guild" : " is-other"}`}
    >
      <label
        className="profile-candidate-select"
        title={`Позначити ${character.name}`}
      >
        <input
          data-profile-candidate-checkbox="true"
          form={bulkFormId}
          type="checkbox"
          name="characterKeys"
          value={character.key}
          aria-label={`Вибрати ${character.name}`}
        />
        <span aria-hidden="true" />
      </label>
      <span className="profile-character-candidate__avatar">
        {image ? (
          <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          character.name.charAt(0)
        )}
      </span>
      <span className="profile-character-candidate__body">
        <strong>
          {character.name}{" "}
          <em className="profile-character-candidate__kind">{kindLabel}</em>
        </strong>
        <small>
          {realmLabel} •{" "}
          {character.activeSpecName ? `${character.activeSpecName} ` : ""}
          {character.className || "Клас невідомий"} •{" "}
          {wowRoleLabel(character.activeSpecRole)}
          {typeof character.itemLevel === "number"
            ? ` • ilvl ${character.itemLevel}`
            : ""}
          {typeof character.level === "number"
            ? ` • lvl ${character.level}`
            : ""}
        </small>
        {extraMeta.length ? <small>{extraMeta.join(" • ")}</small> : null}
      </span>
    </li>
  );
}
