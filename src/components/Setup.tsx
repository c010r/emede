import { useState } from 'react';
import { useStore } from '../store';
import { storage } from '../storage';
import { aiOf, hasAI, providerLabel } from '../providers';
import { useT, type MsgKey } from '../i18n';
import { AISettings } from './AISettings';
import { VaultSettings } from './VaultSettings';
import { LanguageFields } from './Modals';
import { Logo } from './Logo';

const STEPS = ['welcome', 'ai', 'obsidian', 'done'] as const;
type Step = (typeof STEPS)[number];
const LABEL: Record<Step, MsgKey> = { welcome: 'setup.step.welcome', ai: 'setup.step.ai', obsidian: 'setup.step.obsidian', done: 'setup.step.done' };

/**
 * Pantalla de instalación: la primera vez que se abre emede (o desde Ajustes) guía por el idioma,
 * la IA con su API key y, si se quiere, el vault de Obsidian. Todo queda en los mismos ajustes que ⚙ Ajustes.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [step, setStep] = useState<Step>('welcome');
  const [obsidian, setObsidian] = useState<boolean | null>(settings.vaultPath?.trim() ? true : null);
  const i = STEPS.indexOf(step);
  const ai = hasAI(settings);
  const cfg = aiOf(settings);
  const backend = storage();
  const dataWhere = backend.kind === 'file' ? t('setup.dataWhere', { path: backend.location }) : t('setup.dataBrowser');

  const finish = () => {
    setSettings({ setupDone: true });
    onDone();
  };
  const next = () => (step === 'done' ? finish() : setStep(STEPS[i + 1]));
  const chooseObsidian = (yes: boolean) => {
    setObsidian(yes);
    if (!yes) setSettings({ vaultPath: '' });
  };

  return (
    <div className="grid min-h-full place-items-start justify-center overflow-auto bg-bg px-4 py-[clamp(16px,6vh,64px)]">
      <div className="flex w-[min(640px,100%)] flex-col gap-3.5 rounded-[14px] border border-line bg-panel p-[22px] [&_h1]:mt-1 [&_h1]:mb-0 [&_h1]:text-[22px] [&_h1]:font-bold">
        <Logo />
        <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px] text-muted" aria-label={t('setup.title')}>
          {STEPS.map((s, n) => (
            <li key={s} className={`flex items-center gap-1.5 ${n === i ? 'font-semibold text-fg [&>span]:border-accent [&>span]:text-accent' : n < i ? 'text-ok' : ''}`} aria-current={n === i ? 'step' : undefined}>
              <span className="inline-grid size-[22px] place-items-center rounded-full border border-line text-xs">{n < i ? '✔' : n + 1}</span> {t(LABEL[s])}
            </li>
          ))}
        </ol>

        {step === 'welcome' && (
          <>
            <h1>{t('setup.welcomeTitle')}</h1>
            <p className="text-muted">{t('setup.welcomeText')}</p>
            <LanguageFields />
            <p className="text-xs text-muted">💾 {dataWhere}</p>
          </>
        )}

        {step === 'ai' && (
          <>
            <h1>{t('setup.aiTitle')}</h1>
            <p className="text-muted">{t('setup.aiText')}</p>
            <AISettings />
          </>
        )}

        {step === 'obsidian' && (
          <>
            <h1>{t('setup.obsTitle')}</h1>
            <p className="text-muted">{t('setup.obsText')}</p>
            <div className="grid grid-cols-2 gap-1.5 max-[520px]:grid-cols-1" role="radiogroup" aria-label={t('setup.obsTitle')}>
              <button role="radio" aria-checked={obsidian === true} className={`provider ${obsidian === true ? 'on' : ''}`} onClick={() => chooseObsidian(true)}>
                {t('setup.obsYes')}
              </button>
              <button role="radio" aria-checked={obsidian === false} className={`provider ${obsidian === false ? 'on' : ''}`} onClick={() => chooseObsidian(false)}>
                {t('setup.obsNo')}
              </button>
            </div>
            {obsidian && <VaultSettings />}
          </>
        )}

        {step === 'done' && (
          <>
            <h1>{t('setup.doneTitle')}</h1>
            <dl className="setup-summary m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dt]:font-semibold">
              <dt>{t('setup.sumAi')}</dt>
              <dd className={ai ? 'text-ok' : 'text-muted'}>
                {ai ? `✔ ${t('setup.sumAiOk', { provider: providerLabel(cfg.provider), model: cfg.model })}` : `⚠ ${t('setup.sumAiMissing')}`}
              </dd>
              <dt>{t('setup.sumObs')}</dt>
              <dd className={settings.vaultPath?.trim() ? 'text-ok' : 'text-muted'}>
                {settings.vaultPath?.trim() ? `✔ ${settings.vaultPath.trim()}` : t('setup.sumObsOff')}
              </dd>
              <dt>{t('setup.sumData')}</dt>
              <dd className="text-muted">{dataWhere}</dd>
            </dl>
            <p className="text-xs text-muted">{t('setup.changeLater')}</p>
          </>
        )}

        <div className="modal-foot">
          {i > 0 && <button className="btn ghost" onClick={() => setStep(STEPS[i - 1])}>{t('common.back')}</button>}
          <button className="btn primary" onClick={next}>
            {step === 'done' ? t('setup.start') : step === 'ai' && !ai ? t('setup.aiLater') : step === 'obsidian' && !obsidian ? t('setup.obsSkip') : t('setup.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
