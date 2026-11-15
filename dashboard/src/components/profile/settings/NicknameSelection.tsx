"use client";
import { useState } from "react";
import Button from "@/components/ui/Button";
import styles from "../profile-workspace.module.css";

export type NicknameChoice = { key: string; name: string; detail: string };
export default function NicknameSelection({ choices, selected, returnTo }: { choices: NicknameChoice[]; selected: string[]; returnTo?: string }) {
  const [keys, setKeys] = useState(() => selected.filter(key => choices.some(choice => choice.key === key)).slice(0, 2));
  return <form className={styles.stack} action="/api/profile/nickname-characters" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <p className={styles.hint} role="status" aria-live="polite">Вибрано {keys.length} із 2 альтів. Мейн додається автоматично.</p>
    {choices.map(choice => <label className={styles.option} key={choice.key}>
      <input type="checkbox" name="nicknameCharacterKeys" value={choice.key} checked={keys.includes(choice.key)}
        disabled={keys.length >= 2 && !keys.includes(choice.key)} onChange={event => setKeys(current => event.target.checked ? [...current, choice.key].slice(0, 2) : current.filter(key => key !== choice.key))} />
      <span><strong>{choice.name}</strong><small>{choice.detail}</small></span>
    </label>)}
    <Button type="submit" tone="primary">Зберегти альтів для ніку</Button>
  </form>;
}
