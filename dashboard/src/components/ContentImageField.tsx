'use client';
import {useEffect,useId,useState} from 'react';
import {contentImageUrl} from '@/lib/contentModel';
import styles from './content/content.module.css';
type Props={label:string;hint:string;currentImage?:string;previewBaseUrl?:string;onChange?:()=>void;onPreviewChange?:(url:string)=>void};
export default function ContentImageField({label,hint,currentImage='',previewBaseUrl='',onChange,onPreviewChange}:Props){
 const id=useId(),[file,setFile]=useState<File|null>(null),[blob,setBlob]=useState(''),[remove,setRemove]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!file){setBlob('');return;}const url=URL.createObjectURL(file);setBlob(url);return()=>URL.revokeObjectURL(url);},[file]);
 const src=remove?'':blob||contentImageUrl(currentImage,previewBaseUrl);
 useEffect(()=>{onPreviewChange?.(src);},[src,onPreviewChange]);
 return <div className={styles.imageField}><label htmlFor={id}>{label}</label><input id={id} type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" disabled={remove} aria-describedby={`${id}-hint`} onChange={event=>{const next=event.target.files?.[0]||null;if(next&&(!['image/png','image/jpeg','image/webp','image/gif'].includes(next.type)||next.size>8*1024*1024)){event.target.value='';setFile(null);setError('Обери JPG, PNG, WEBP або GIF до 8 MB.');onChange?.();return;}setError('');setFile(next);onChange?.();}}/><small id={`${id}-hint`}>{hint}</small>
 {error?<p className={styles.error} role="alert">{error}</p>:null}{src?<img src={src} alt="Попередній перегляд обкладинки" className={styles.cover}/>:<div className={styles.coverPlaceholder}>Обкладинку не вибрано</div>}
 {file?<small>{file.name} · {(file.size/1024/1024).toFixed(2)} MB</small>:null}
 {currentImage?<label className={styles.check}><input type="checkbox" name="removeImage" value="1" checked={remove} onChange={event=>{setRemove(event.target.checked);setFile(null);const input=document.getElementById(id) as HTMLInputElement|null;if(input)input.value='';setError('');onChange?.();}}/>Прибрати поточну обкладинку</label>:null}
 </div>;
}
