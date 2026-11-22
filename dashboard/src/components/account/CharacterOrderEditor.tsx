"use client";

import { useState, type CSSProperties, type DragEvent } from "react";
import type { ProfileCharacter } from "@/lib/profiles";
import { wowClassColorByName } from "@/lib/wowClassCatalog";
import { characterEdition, WOW_EDITION_LABEL } from "@/lib/wowEdition";
import styles from "./account.module.css";

type Item = Pick<ProfileCharacter, "key" | "name" | "className" | "activeSpecName" | "realmName" | "realmSlug" | "avatarUrl" | "isMain" | "edition">;

function moved<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function CharacterLine({ character, pinned }: { character: Item; pinned?: boolean }) {
  const color = wowClassColorByName(character.className);
  const edition = characterEdition(character);
  return <span className={styles.orderCopy} style={color ? { "--guild-class-color": color } as CSSProperties : undefined}>
    <span className={styles.orderAvatar}>{character.avatarUrl ? <img src={character.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">{character.name.charAt(0)}</span>}</span>
    <span className={styles.rowCopy}>
      <strong>{character.name}{pinned ? " · мейн" : ""}</strong>
      <small>{[character.activeSpecName, character.className].filter(Boolean).join(" ") || "Клас невідомий"} · {edition === "forever" ? WOW_EDITION_LABEL.forever : character.realmName || character.realmSlug}</small>
    </span>
  </span>;
}

/**
 * Display order of the profile's characters. The main is pinned first (it is first
 * everywhere); the rest move with ↑/↓ or drag and drop. Saved with one form POST,
 * so it also works as plain HTML before hydration finishes.
 */
export default function CharacterOrderEditor({ characters, returnTo }: { characters: Item[]; returnTo: string }) {
  const main = characters.find(item => item.isMain) || null;
  const initial = characters.filter(item => item !== main);
  const [order, setOrder] = useState(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const changed = order.some((item, index) => item.key !== initial[index]?.key);
  if (initial.length < 2) return null;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder(current => moved(current, from, to));
  };
  const onDrop = (event: DragEvent<HTMLLIElement>, to: number) => {
    event.preventDefault();
    if (dragIndex !== null) move(dragIndex, to);
    setDragIndex(null);
  };

  return <form className={styles.orderEditor} action="/api/profile/characters/order" method="post" aria-labelledby="character-order-title">
    <div className={styles.orderHead}>
      <span className={styles.rowCopy}>
        <strong id="character-order-title">Порядок персонажів</strong>
        <small>Так їх видно у профілі та на сайті. Мейн завжди перший.</small>
      </span>
      <div className={styles.orderActions}>
        {changed ? <button type="button" className="btn subtle" onClick={() => setOrder(initial)}>Скинути</button> : null}
        <button type="submit" className="btn primary" disabled={!changed}>Зберегти порядок</button>
      </div>
    </div>
    <input type="hidden" name="returnTo" value={returnTo} />
    <ol className={styles.orderList}>
      {main ? <li className={styles.orderItem} data-pinned="true"><span className={styles.orderIndex} aria-hidden="true">1</span><CharacterLine character={main} pinned /></li> : null}
      {order.map((character, index) => <li key={character.key} className={styles.orderItem} draggable
        data-dragging={dragIndex === index || undefined}
        onDragStart={event => { setDragIndex(index); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={event => onDrop(event, index)} onDragEnd={() => setDragIndex(null)}>
        <input type="hidden" name="order" value={character.key} />
        <span className={styles.orderIndex} aria-hidden="true">{index + (main ? 2 : 1)}</span>
        <CharacterLine character={character} />
        <span className={styles.orderMove}>
          <button type="button" className="btn subtle" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Перемістити ${character.name} вище`}>↑</button>
          <button type="button" className="btn subtle" onClick={() => move(index, index + 1)} disabled={index === order.length - 1} aria-label={`Перемістити ${character.name} нижче`}>↓</button>
        </span>
      </li>)}
    </ol>
  </form>;
}
