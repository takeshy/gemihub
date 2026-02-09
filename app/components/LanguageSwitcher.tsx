import { Globe } from "lucide-react";
import type { Language } from "~/types/settings";

interface LanguageSwitcherProps {
  lang: Language;
  /** Base path without trailing slash, e.g. "/terms" */
  basePath: string;
}

export function LanguageSwitcher({ lang, basePath }: LanguageSwitcherProps) {
  const enHref = basePath;
  const jaHref = `${basePath}/ja`;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/80 px-2.5 py-1.5 text-sm shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/80">
      <Globe size={14} className="text-gray-500 dark:text-gray-400" />
      {lang === "en" ? (
        <>
          <span className="font-semibold text-gray-900 dark:text-gray-100">EN</span>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <a href={jaHref} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">JA</a>
        </>
      ) : (
        <>
          <a href={enHref} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">EN</a>
          <span className="text-gray-300 dark:text-gray-600">/</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">JA</span>
        </>
      )}
    </div>
  );
}
