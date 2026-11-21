import type { CSSProperties } from "react";
import type { ProfileCharacter } from "@/lib/profiles";
import { wowClassColorByName } from "@/lib/wowClassCatalog";
import { wowRoleLabel } from "@/lib/wowRoles";
import { characterEdition, WOW_EDITION_LABEL } from "@/lib/wowEdition";
import styles from "./account.module.css";

/** The main character up front: class colour, spec, realm and the numbers raid leaders look at. */
export default function MainCharacterShowcase({ character }: { character: ProfileCharacter }) {
  const color = wowClassColorByName(character.className);
  const image = character.renderUrl || character.avatarUrl || null;
  const edition = characterEdition(character);
  const rio = edition === "retail" && typeof character.raiderIo?.currentScore === "number" && character.raiderIo.currentScore > 0 ? Math.round(character.raiderIo.currentScore) : null;
  return <section className={styles.showcase} aria-label={`Основний персонаж: ${character.name}`} style={color ? { "--guild-class-color": color } as CSSProperties : undefined}>
    <span className={styles.charArt}>{image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{character.name.charAt(0)}</span>}</span>
    <div className={styles.showcaseCopy}>
      <span className={styles.showcaseEyebrow}>Мейн · {WOW_EDITION_LABEL[edition]}</span>
      <h2>{character.name}</h2>
      <p>{[character.activeSpecName, character.className].filter(Boolean).join(" ") || "Клас невідомий"} · {wowRoleLabel(character.activeSpecRole)} · {edition === "forever" ? "WoW Forever" : character.realmName || character.realmSlug}</p>
    </div>
    <dl className={styles.showcaseStats}>
      <div><dt>ilvl</dt><dd>{typeof character.itemLevel === "number" ? character.itemLevel : "—"}</dd></div>
      <div><dt>RIO</dt><dd>{rio ?? "—"}</dd></div>
      <div><dt>Рівень</dt><dd>{typeof character.level === "number" ? character.level : "—"}</dd></div>
    </dl>
  </section>;
}
