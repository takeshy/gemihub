import { storefrontText } from "../shared/storefront-copy";
import React from "react";
import { Presentation } from "./Presentation";
import { GoogleMap } from "./GoogleMap";
import { MenuImage } from "./MenuImage";
import { intlLocale, listSeparator, tr } from "../shared/i18n";
import { currencyOf, formatMoney, regionOf } from "../shared/region";
import { bookingStaff, hoursText, specialDaysText, type ShopConfig } from "../server/domain";

/** `imageSources` maps image ids to URLs for static pages; without it, images load through `imageBase`. */
export function ShopAbout({ config: c, imageSources = {}, imageBase, menuImageBase = imageBase }: { config: ShopConfig; imageSources?: Record<string, string>; imageBase?: string; menuImageBase?: string }) {
  const image = (id: string | undefined, name: string, className = "menu-image", base = imageBase) => id && imageSources[id]
    ? <span className={className}><img src={imageSources[id]} alt={tr("{0}の画像", name)} /></span>
    : base ? <MenuImage imageId={id} imageBase={base} name={name} className={className} /> : null;
  const menus = <div className="about-menus">{c.menus.filter(menu => menu.active).map(menu => <div className="menu-row" key={menu.id}>{image(menu.imageId, menu.name, "menu-image", menuImageBase)}{menu.name}{menu.optionFor && <span className="pill">{tr("追加メニュー")}</span>} · {menu.duration}{tr("分 ")}<b>{formatMoney(menu.price, currencyOf(regionOf(c)), intlLocale())}</b></div>)}</div>;
  const staff = <div className="public-staff-list">{bookingStaff(c).map(person => <div key={person.id}>{image(person.imageId, person.name, "staff-photo")}<span>{person.name}</span></div>)}</div>;
  const access = <><p>{c.address}</p><GoogleMap config={c} /></>;
  const days = [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
  const hours = <><p>{hoursText(c)}{tr(" / 定休日：")}{c.hours.closedWeekdays.map(day => days[day]).join(listSeparator())}</p>{!!c.hours.holidays.length && <p>{tr("臨時休業：")}{c.hours.holidays.join(listSeparator("、"))}</p>}{!!c.hours.specialDays?.length && <p>{tr("特別営業日：")}{specialDaysText(c)}</p>}</>;
  return <Presentation design={c.screens?.about} imageBase={imageBase} resolvedImages={imageSources} slots={{ menus, staff, access, hours }} fallback={<div className="panel about"><h2>{c.name}</h2><p>{c.description}</p><h3>{storefrontText(c, "aboutMenus")}</h3>{menus}<h3>{storefrontText(c, "aboutStaff")}</h3>{staff}<h3>{storefrontText(c, "aboutAccess")}</h3>{access}<h3>{storefrontText(c, "aboutHours")}</h3>{hours}</div>} />;
}

