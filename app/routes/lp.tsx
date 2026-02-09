import { LogIn, MessageSquare, Search, Puzzle, GitBranch, Shield } from "lucide-react";
import { useLocation } from "react-router";
import { I18nProvider, useI18n } from "~/i18n/context";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export default function LandingPage() {
  const { pathname } = useLocation();
  const lang: Language = pathname.endsWith("/ja") ? "ja" : "en";

  return (
    <I18nProvider language={lang}>
      <LandingContent lang={lang} />
    </I18nProvider>
  );
}

function LandingContent({ lang }: { lang: Language }) {
  const { t } = useI18n();

  const features = [
    { icon: MessageSquare, titleKey: "lp.features.aiChat.title" as const, descKey: "lp.features.aiChat.description" as const },
    { icon: Search, titleKey: "lp.features.rag.title" as const, descKey: "lp.features.rag.description" as const },
    { icon: Puzzle, titleKey: "lp.features.mcp.title" as const, descKey: "lp.features.mcp.description" as const },
    { icon: GitBranch, titleKey: "lp.features.workflow.title" as const, descKey: "lp.features.workflow.description" as const },
    { icon: Shield, titleKey: "lp.features.yourData.title" as const, descKey: "lp.features.yourData.description" as const },
  ];

  const screenshots = [
    { src: "/images/cap.png", altKey: "lp.screenshots.ide" as const },
    { src: "/images/visual_workflow.png", altKey: "lp.screenshots.workflow" as const },
    { src: "/images/workflow_execution.png", altKey: "lp.screenshots.execution" as const },
  ];

  const jaPrefix = lang === "ja" ? "/ja" : "";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Language switcher */}
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher lang={lang} basePath="/lp" />
      </div>

      {/* Hero */}
      <section className="flex flex-col items-center px-4 pb-16 pt-20 text-center sm:pt-28">
        <img
          src="/icons/icon-192x192.png"
          alt="Gemini Hub"
          width={80}
          height={80}
          className="mb-6 rounded-2xl shadow-lg"
        />
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-50 sm:text-5xl">
          Gemini Hub
        </h1>
        <p className="mx-auto mb-3 max-w-2xl text-lg text-gray-600 dark:text-gray-300 sm:text-xl">
          {t("lp.hero.tagline")}
        </p>
        <p className="mx-auto mb-10 max-w-2xl text-sm text-gray-500 dark:text-gray-400 sm:text-base">
          {t("lp.hero.description")}
        </p>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
        >
          <LogIn size={22} />
          {t("lp.signIn")}
        </a>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900"
            >
              <Icon size={28} className="mb-3 text-blue-600 dark:text-blue-400" />
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t(titleKey)}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {t(descKey)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {t("lp.screenshots.title")}
        </h2>
        <div className="space-y-10">
          {screenshots.map(({ src, altKey }) => (
            <figure key={src} className="overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-gray-800">
              <img
                src={src}
                alt={t(altKey)}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="bg-gray-50 px-4 py-2.5 text-center text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-400">
                {t(altKey)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="flex flex-col items-center border-t border-gray-200 px-4 py-16 dark:border-gray-800">
        <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-50">
          {t("lp.cta.ready")}
        </h2>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
        >
          <LogIn size={22} />
          {t("lp.signIn")}
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex gap-6">
            <a href={`/terms${jaPrefix}`} className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {t("lp.footer.terms")}
            </a>
            <a href={`/policy${jaPrefix}`} className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {t("lp.footer.policy")}
            </a>
            <a href="mailto:takeshy.work@gmail.com" className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {t("lp.footer.contact")}
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} <a href="https://takeshy.work" className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">takeshy.work</a></p>
        </div>
      </footer>
    </div>
  );
}
