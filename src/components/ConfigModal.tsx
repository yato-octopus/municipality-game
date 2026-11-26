import React, { useEffect, useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { playUiClick } from '../services/soundService';
import { DEFAULT_CONFIG } from '../services/storageService';
import type { ConfigState } from '../types/game';

interface ConfigModalProps {
  config: ConfigState;
  onChange: (next: ConfigState) => void;
  onRetry?: () => void;
  onGoHome?: () => void;
  onClose: () => void;
}

type BooleanConfigKey = {
  [K in keyof ConfigState]: ConfigState[K] extends boolean ? K : never;
}[keyof ConfigState];

type ConfigCategory = 'all' | 'appearance' | 'gameplay' | 'controls' | 'system';

const CONFIG_CATEGORIES: { id: ConfigCategory; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'appearance', label: '外観・地図' },
  { id: 'gameplay', label: 'プレイ・モード' },
  { id: 'controls', label: '操作・サウンド' },
  { id: 'system', label: '保存・動作' },
];

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  onChange,
  onRetry,
  onGoHome,
  onClose,
}) => {
  useEscapeClose(true, onClose);

  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('all');
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmRetry) return;
    const t = window.setTimeout(() => setConfirmRetry(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmRetry]);

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const toggle = (key: BooleanConfigKey) => {
    onChange({ ...config, [key]: !config[key] });
  };

  const showSection = (category: Exclude<ConfigCategory, 'all'>) =>
    activeCategory === 'all' || activeCategory === category;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card config-modal"
        role="dialog"
        aria-modal="true"
        aria-label="メニュー / 詳細設定"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{onRetry || onGoHome ? 'メニュー / 詳細設定' : '表示・操作の詳細設定'}</h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="閉じる"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="config-category-tabs" role="group" aria-label="設定カテゴリ">
          {CONFIG_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={activeCategory === cat.id ? 'active' : ''}
              aria-pressed={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {/* In-game Quick actions */}
          {(onGoHome || onRetry) && (
            <div className="config-quick-actions">
              {onGoHome && (
                <button type="button" className="btn-secondary" onClick={onGoHome}>
                  🏠 ホームへ
                </button>
              )}
              {onRetry && (
                <button
                  type="button"
                  className={
                    confirmRetry ? 'btn-danger confirm-inline-btn' : 'btn-warning'
                  }
                  onClick={() => {
                    if (!confirmRetry) {
                      setConfirmRetry(true);
                      return;
                    }
                    setConfirmRetry(false);
                    onRetry();
                  }}
                >
                  {confirmRetry ? 'もう一度押してリトライ確定' : '↻ リトライ'}
                </button>
              )}
            </div>
          )}

          {/* Category 1: Appearance & Map */}
          {showSection('appearance') && (
            <section className="config-section">
              <div className="config-section-header">
                <h4 className="config-section-heading">外観・地図</h4>
                <p className="config-section-desc">画面テーマと地図上の表示項目</p>
              </div>

              <div className="config-slider-row">
                <span>外観テーマ</span>
                <div className="segmented-control" role="group" aria-label="外観テーマ">
                  <button
                    type="button"
                    className={config.uiTheme === 'google' ? 'active' : ''}
                    aria-pressed={config.uiTheme === 'google'}
                    onClick={() => onChange({ ...config, uiTheme: 'google' })}
                  >
                    モダン
                  </button>
                  <button
                    type="button"
                    className={config.uiTheme === 'classic' ? 'active' : ''}
                    aria-pressed={config.uiTheme === 'classic'}
                    onClick={() => onChange({ ...config, uiTheme: 'classic' })}
                  >
                    クラシック
                  </button>
                </div>
              </div>

              <div className="config-slider-row">
                <span>地図スタイル</span>
                <div className="segmented-control" role="group" aria-label="地図スタイル">
                  <button
                    type="button"
                    className={config.silhouette ? 'active' : ''}
                    aria-pressed={config.silhouette}
                    onClick={() => onChange({ ...config, silhouette: true })}
                  >
                    白地図
                  </button>
                  <button
                    type="button"
                    className={!config.silhouette ? 'active' : ''}
                    aria-pressed={!config.silhouette}
                    onClick={() => onChange({ ...config, silhouette: false })}
                  >
                    色分け図
                  </button>
                </div>
              </div>

              <div className="config-grid">
                <label className="config-check">
                  <input
                    type="checkbox"
                    checked={config.showBorder}
                    onChange={() => toggle('showBorder')}
                  />
                  <span>境界線を表示</span>
                </label>
                <label className="config-check">
                  <input
                    type="checkbox"
                    checked={config.showTag}
                    onChange={() => toggle('showTag')}
                  />
                  <span>地図上のタグマーカー</span>
                </label>
                <label className="config-check">
                  <input
                    type="checkbox"
                    checked={config.nameOnFix}
                    onChange={() => toggle('nameOnFix')}
                  />
                  <span>回答後に地図へ地名を表示</span>
                </label>
                <label className="config-check">
                  <input
                    type="checkbox"
                    checked={config.showPieceInfo}
                    onChange={() => toggle('showPieceInfo')}
                  />
                  <span>地名の情報ウィンドウ</span>
                </label>
              </div>
            </section>
          )}

          {/* Category 2: Gameplay & Modes */}
          {showSection('gameplay') && (
            <section className="config-section">
              <div className="config-section-header">
                <h4 className="config-section-heading">プレイ・モード</h4>
                <p className="config-section-desc">
                  ヒント・タイマーと各ゲームモードの補助表示
                </p>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">共通</div>
                <div className="config-slider-row">
                  <span>ヒントボタン</span>
                  <div className="segmented-control" role="group" aria-label="ヒントボタン表示">
                    <button
                      type="button"
                      className={!config.disableHelpButton ? 'active' : ''}
                      aria-pressed={!config.disableHelpButton}
                      onClick={() => onChange({ ...config, disableHelpButton: false })}
                    >
                      表示 (ON)
                    </button>
                    <button
                      type="button"
                      className={config.disableHelpButton ? 'active' : ''}
                      aria-pressed={config.disableHelpButton}
                      onClick={() => onChange({ ...config, disableHelpButton: true })}
                    >
                      非表示 (OFF)
                    </button>
                  </div>
                </div>
                <div className="config-grid">
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.showTime}
                      onChange={() => toggle('showTime')}
                    />
                    <span>タイマーを表示</span>
                  </label>
                </div>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">クイズ</div>
                <div className="config-slider-row">
                  <span>選択肢の配置</span>
                  <div className="segmented-control" role="group" aria-label="クイズ選択肢の配置">
                    <button
                      type="button"
                      className={config.quizChoiceLayout === 'pointing' ? 'active' : ''}
                      aria-pressed={config.quizChoiceLayout === 'pointing'}
                      onClick={() => onChange({ ...config, quizChoiceLayout: 'pointing' })}
                    >
                      地図上
                    </button>
                    <button
                      type="button"
                      className={config.quizChoiceLayout === 'bottom' ? 'active' : ''}
                      aria-pressed={config.quizChoiceLayout === 'bottom'}
                      onClick={() => onChange({ ...config, quizChoiceLayout: 'bottom' })}
                    >
                      下部パネル
                    </button>
                  </div>
                </div>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">パズル</div>
                <div className="config-grid">
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.showPieceList}
                      onChange={() => toggle('showPieceList')}
                    />
                    <span>ピース一覧トレイを表示</span>
                  </label>
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.nameInList}
                      onChange={() => toggle('nameInList')}
                    />
                    <span>トレイ内に地名を表示</span>
                  </label>
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.nameOnDrag}
                      onChange={() => toggle('nameOnDrag')}
                    />
                    <span>ドラッグ中に地名を表示</span>
                  </label>
                </div>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">読み方</div>
                <div className="config-grid">
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.showYomikataKanji}
                      onChange={() => toggle('showYomikataKanji')}
                    />
                    <span>地名の漢字を表示</span>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* Category 3: Controls & Sound */}
          {showSection('controls') && (
            <section className="config-section">
              <div className="config-section-header">
                <h4 className="config-section-heading">操作・サウンド</h4>
                <p className="config-section-desc">地図操作の慣性・振動と効果音</p>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">サウンド</div>
                <div className="config-grid">
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.fixActionSound}
                      onChange={() => toggle('fixActionSound')}
                    />
                    <span>効果音を有効にする</span>
                  </label>
                </div>
                <div className="config-slider-row">
                  <span>SE音量 ({config.seVolume}%)</span>
                  <div className="config-slider-controls">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={config.seVolume}
                      aria-label="SE音量"
                      onChange={(e) =>
                        onChange({ ...config, seVolume: Number(e.target.value) })
                      }
                    />
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => playUiClick(config.seVolume)}
                    >
                      試聴
                    </button>
                  </div>
                </div>
              </div>

              <div className="config-subgroup">
                <div className="config-subgroup-title">操作・フィードバック</div>
                <label className="config-slider-row">
                  <span>マップドラッグ慣性 ({Math.round(config.dragInertia * 100)}%)</span>
                  <input
                    type="range"
                    min={0}
                    max={1.0}
                    step={0.05}
                    value={config.dragInertia}
                    onChange={(e) =>
                      onChange({ ...config, dragInertia: Number(e.target.value) })
                    }
                  />
                </label>
                <div className="config-grid">
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.reverseJumpButtons}
                      onChange={() => toggle('reverseJumpButtons')}
                    />
                    <span>地方移動ボタンを逆順に並べる</span>
                  </label>
                  <label className="config-check">
                    <input
                      type="checkbox"
                      checked={config.fixActionVibration}
                      onChange={() => toggle('fixActionVibration')}
                    />
                    <span>バイブレーション（対応端末）</span>
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* Category 4: Save & Performance */}
          {showSection('system') && (
            <section className="config-section">
              <div className="config-section-header">
                <h4 className="config-section-heading">保存・動作</h4>
                <p className="config-section-desc">オートセーブ頻度と描画パフォーマンス</p>
              </div>

              <div className="config-slider-row">
                <span>オートセーブ</span>
                <div className="segmented-control" role="group" aria-label="オートセーブ頻度">
                  <button
                    type="button"
                    className={config.autoSaveTiming === 'every_answer' ? 'active' : ''}
                    aria-pressed={config.autoSaveTiming === 'every_answer'}
                    onClick={() => onChange({ ...config, autoSaveTiming: 'every_answer' })}
                  >
                    正解ごと
                  </button>
                  <button
                    type="button"
                    className={config.autoSaveTiming === 'on_exit' ? 'active' : ''}
                    aria-pressed={config.autoSaveTiming === 'on_exit'}
                    onClick={() => onChange({ ...config, autoSaveTiming: 'on_exit' })}
                  >
                    終了・切替時
                  </button>
                </div>
              </div>

              <div className="config-slider-row">
                <span>描画品質 / アニメ</span>
                <div className="segmented-control" role="group" aria-label="描画品質">
                  <button
                    type="button"
                    className={config.quality !== 'low' ? 'active' : ''}
                    aria-pressed={config.quality !== 'low'}
                    onClick={() => onChange({ ...config, quality: 'high' })}
                  >
                    標準・高
                  </button>
                  <button
                    type="button"
                    className={config.quality === 'low' ? 'active' : ''}
                    aria-pressed={config.quality === 'low'}
                    onClick={() => onChange({ ...config, quality: 'low' })}
                  >
                    軽量
                  </button>
                </div>
              </div>

              <div className="config-slider-row">
                <span>FPS設定</span>
                <div className="segmented-control" role="group" aria-label="FPS設定">
                  <button
                    type="button"
                    className={config.fpsMode === 'high' ? 'active' : ''}
                    aria-pressed={config.fpsMode === 'high'}
                    onClick={() => onChange({ ...config, fpsMode: 'high' })}
                  >
                    60fps
                  </button>
                  <button
                    type="button"
                    className={config.fpsMode === 'low' ? 'active' : ''}
                    aria-pressed={config.fpsMode === 'low'}
                    onClick={() => onChange({ ...config, fpsMode: 'low' })}
                  >
                    30fps（省電力）
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className={
              confirmReset
                ? 'btn-danger btn-sm config-reset-btn confirm-inline-btn'
                : 'btn-ghost btn-sm config-reset-btn'
            }
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              onChange({ ...DEFAULT_CONFIG });
            }}
          >
            {confirmReset ? 'もう一度押してリセット確定' : '初期設定に戻す'}
          </button>
          <button type="button" className="btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
