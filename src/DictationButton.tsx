import { tr, getLocale, intlLocale } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createDictation, defaultEndKeyword, endKeywordStorageKey, type SpeechConstructor } from "./dictation";

export function DictationButton({disabled,value,onChange,onSend,onListening,stopRef,label=tr("音声入力"),maxLength=4000}:{
  disabled?:boolean;value:string;onChange:(text:string)=>void;onSend?:(text:string)=>void;
  onListening?:(listening:boolean)=>void;stopRef?:React.RefObject<(()=>void)|null>;label?:string;maxLength?:number;
}) {
  const callbacks=useRef({onChange,onSend,onListening});callbacks.current={onChange,onSend,onListening};
  const text=useRef(value);text.current=value;
  const alive=useRef(true);
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false);
  const [state,setState]=useState({listening:false,error:""});
  const keywordKey = endKeywordStorageKey + (getLocale() === "en" ? ":en" : "");
  const initialKeyword = getLocale() === "en" ? "send" : defaultEndKeyword;
  const [keyword,setKeyword]=useState(()=>{try{return localStorage.getItem(keywordKey)??initialKeyword;}catch{return initialKeyword;}});
  const engine=useRef<ReturnType<typeof createDictation>|null>(null);
  if(!engine.current)engine.current=createDictation({language:intlLocale(),
    createRecognition:()=>{const win=window as unknown as {SpeechRecognition?:SpeechConstructor;webkitSpeechRecognition?:SpeechConstructor};const Speech=win.SpeechRecognition||win.webkitSpeechRecognition;if(!Speech)throw new Error("unsupported");return new Speech();},
    getText:()=>text.current,
    onInput:value=>{text.current=value;callbacks.current.onChange(value);},
    onSend:value=>{if(alive.current)setOpen(false);callbacks.current.onSend?.(value);},
    onState:state=>{if(alive.current){setState(state);callbacks.current.onListening?.(state.listening);}},maxLength,
  });
  function close(){engine.current?.stop();if(alive.current)setOpen(false);}
  useEffect(()=>{
    alive.current=true;const stop=()=>{engine.current?.stop();if(alive.current)setOpen(false);};if(stopRef)stopRef.current=stop;
    window.addEventListener("pagehide",stop);
    return()=>{alive.current=false;stop();callbacks.current.onListening?.(false);if(stopRef)stopRef.current=null;window.removeEventListener("pagehide",stop);};
  },[stopRef]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  const phrases=keyword.split(/[,、\n]/).map(value=>value.trim()).filter(Boolean);
  return <div className="dictation">
    <button type="button" className="dictation-toggle" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{setOpen(true);engine.current?.start(keyword);}}>{label}</button>
    {open&&createPortal(<dialog ref={dialog} className="dictation-dialog" aria-label={tr("音声入力")} onCancel={close} onClose={close} onClick={event=>{if(event.target===event.currentTarget)close();}}>
      <div className="section-top"><h2>{tr("音声入力")}</h2><button type="button" autoFocus aria-label={tr("閉じる")} onClick={close}>×</button></div>
      <p className="dictation-status" role="status"><span className={state.listening?"dictation-indicator listening":"dictation-indicator"} aria-hidden="true"/>{state.listening?tr("聞いています…"):tr("音声入力を停止しています")}</p>
      <p className="dictation-keyword-hint">{phrases.length?tr("入力を終えるときは「{0}」と言ってください。{1}", phrases.join("」「"), onSend?tr("その言葉を除いて送信します。"):tr("その言葉を除いて入力を終了します。")):tr("終了キーワードは設定されていません。ボタンで停止できます。")}</p>
      <label className="dictation-transcript">{tr("書き起こした内容")}<textarea aria-label={tr("書き起こした内容")} value={value} rows={6} maxLength={maxLength} onChange={event=>{text.current=event.target.value;onChange(event.target.value);}} placeholder={tr("話した内容がここに表示されます。手で修正することもできます。")}/></label>
      {state.error&&<p className="dictation-error" role="alert">{state.error}</p>}
      <details className="dictation-settings"><summary>{tr("終了キーワードを変更する")}</summary><label>{tr("終了キーワード")}<input aria-label={tr("終了キーワード")} value={keyword} maxLength={100} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}} disabled={state.listening} onChange={event=>{setKeyword(event.target.value);try{localStorage.setItem(keywordKey,event.target.value);}catch{}}}/></label><span>{tr("末尾で言うと、その言葉を除いて")}{onSend?tr("送信します"):tr("入力を終了します")}{tr("。空欄で無効にできます。")}</span></details>
      <div className="dictation-dialog-actions">
        <button type="button" className="dictation-record" onClick={()=>state.listening?engine.current?.stop():engine.current?.start(keyword)}>{state.listening?tr("音声入力を止める"):tr("音声入力を再開")}</button>
        <button type="button" onClick={close}>{tr("下書きに戻る")}</button>
        <button type="button" className="primary" disabled={!value.trim()} onClick={()=>{const value=text.current;close();if(onSend&&value.trim())onSend(value);}}>{onSend?tr("送信"):tr("入力を使う")}</button>
      </div>
    </dialog>,document.body)}
  </div>;
}
