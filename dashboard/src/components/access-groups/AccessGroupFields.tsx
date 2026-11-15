"use client";
import type { DashboardRole } from "@/types/auth";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import type { GroupValues } from "@/lib/accessGroupDrafts";
import FormSection from "@/components/page/FormSection";
import { ROLE_OPTIONS } from "./groupLabels";
import styles from "./groups.module.css";
export default function AccessGroupFields({values,group,blocked,fixedRole,fixedRank,isServerOwner,edit}:{values:GroupValues;group?:AccessGroup;blocked:boolean;fixedRole:boolean;fixedRank:boolean;isServerOwner:boolean;edit:(patch:Partial<GroupValues>)=>void}){return <FormSection title="Параметри групи"><div className={`access-form-grid ${styles.fields}`}>
            <label>
              <span>ID групи</span>
              <input
                className="input"
                name="id"
                value={values.id}
                onChange={(event) => edit({ id: event.target.value })}
                required
                maxLength={32}
                pattern="[A-Za-z0-9_-]{1,32}"
                readOnly={blocked || group?.lockedId}
                autoComplete="off"
              />
              <small>
                {group?.lockedId
                  ? "Системний ID не змінюється."
                  : "Латиниця, цифри, _ або -. При зміні ID призначення профілів переносяться разом із групою; старий ID залишається зарезервованим."}
              </small>
            </label>
            <label>
              <span>Назва групи</span>
              <input
                className="input"
                name="name"
                value={values.name}
                onChange={(event) => edit({ name: event.target.value })}
                required
                maxLength={80}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Роль у системі</span>
              <select
                className="select"
                name="role"
                value={values.role}
                onChange={(event) =>
                  edit({ role: event.target.value as DashboardRole })
                }
                disabled={blocked || fixedRole}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option
                    key={role.value}
                    value={role.value}
                    disabled={role.value === "admin" && !isServerOwner}
                  >
                    {role.label}
                  </option>
                ))}
              </select>
              <small>
                {fixedRole
                  ? "Для системної групи роль зафіксована."
                  : "Права адміністратора видає лише власник сервера."}
              </small>
            </label>
            <label>
              <span>Ранг</span>
              <input
                className="input"
                name="rank"
                type="number"
                min="1"
                max="100"
                value={values.rank}
                onChange={(event) => edit({ rank: event.target.value })}
                readOnly={blocked || fixedRank}
              />
              <small>Вищий ранг має пріоритет, якщо ролей кілька.</small>
            </label>
            <label>
              <span>
                Іконка групи <em>необов’язково</em>
              </span>
              <input
                className="input"
                name="icon"
                value={values.icon}
                onChange={(event) => edit({ icon: event.target.value })}
                maxLength={24}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Discord role ID</span>
              <input
                className="input"
                name="discordRoleId"
                value={values.discordRoleId}
                onChange={(event) =>
                  edit({ discordRoleId: event.target.value })
                }
                maxLength={25}
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                readOnly={blocked}
                autoComplete="off"
              />
              <small>
                Одна група = одна Discord-роль. Поле може бути порожнім.
              </small>
            </label>
          </div></FormSection>;}
