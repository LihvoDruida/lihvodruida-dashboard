"use client";
import { DASHBOARD_PERMISSION_KEYS,PERMISSION_META } from "@/lib/accessGroupSchema";
import type { GroupValues } from "@/lib/accessGroupDrafts";
import FormSection from "@/components/page/FormSection";
import styles from "./groups.module.css";
export default function AccessGroupPermissions({categories,expanded,values,blocked,isServerOwner,edit}:{categories:string[];expanded:string;values:GroupValues;blocked:boolean;isServerOwner:boolean;edit:(patch:Partial<GroupValues>)=>void}){return <FormSection title="Дозволи групи"><div className={`permissions-grid ${styles.permissions}`}>
            {categories.map((category, index) => (
              <details
                className="permissions-category"
                key={`${expanded}:${category}`}
                open={index === 0}
              >
                <summary>
                  {category}
                  <small>
                    {
                      DASHBOARD_PERMISSION_KEYS.filter(
                        (key) => PERMISSION_META[key].category === category,
                      ).length
                    }{" "}
                    прав
                  </small>
                </summary>
                {DASHBOARD_PERMISSION_KEYS.filter(
                  (key) => PERMISSION_META[key].category === category,
                ).map((key) => (
                  <label className="permission-check" key={key}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      checked={values.permissions.includes(key)}
                      disabled={
                        blocked ||
                        key === "dashboard.view" ||
                        (key === "groups.manage" && !isServerOwner)
                      }
                      onChange={(event) =>
                        edit({
                          permissions: event.target.checked
                            ? [...values.permissions, key]
                            : values.permissions.filter((item) => item !== key),
                        })
                      }
                    />
                    <span>
                      <strong>{PERMISSION_META[key].title}</strong>
                      <small>{PERMISSION_META[key].description}</small>
                    </span>
                  </label>
                ))}
              </details>
            ))}
          </div></FormSection>;}
