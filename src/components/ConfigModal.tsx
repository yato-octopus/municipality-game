import React from 'react';
import type { ConfigState } from '../types/game';

interface ConfigModalProps {
  config: ConfigState;
  onChange: (next: ConfigState) => void;
  onRetry: () => void;
  onGoHome: () => void;
  onClose: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  config,
  onChange,
  onRetry,
  onGoHome,
  onClose,
}) => {
  const toggle = (key: keyof ConfigState) => {
    onChange({ ...config, [key]: !config[key] });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>メニュー / 詳細設定</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Quick actions */}
          <div className="config-quick-actions">
            <button type="button" className="btn-secondary" onClick={onGoHome}>
              🏠 ホームへ
            </button>
            <button type="button" className="btn-warning" onClick={onRetry}>
              ↻ リトライ
            </button>
          </div>

          <section className="config-section">
            <label className="config-slider-row">
              <span>SE音量 ({config.seVolume}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                value={config.seVolume}
                onChange={(e) => onChange({ ...config, seVolume: Number(e.target.value) })}
              />
            </label>
          </section>

          <section className="config-section">
            <h4>画面・マップ表示</h4>
            <div className="config-grid">
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.silhouette}
                  onChange={() => toggle('silhouette')}
                />
                <span>シルエット表示（白地図 / 標高図）</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showTime}
                  onChange={() => toggle('showTime')}
                />
                <span>時間表示</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showBorder}
                  onChange={() => toggle('showBorder')}
                />
                <span>境界線</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showPieceInfo}
                  onChange={() => toggle('showPieceInfo')}
                />
                <span>情報ウィンドウ</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showTag}
                  onChange={() => toggle('showTag')}
                />
                <span>タグ表示</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.disableHelpButton}
                  onChange={() => toggle('disableHelpButton')}
                />
                <span>ヒントボタン無効化</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showPieceList}
                  onChange={() => toggle('showPieceList')}
                />
                <span>ピースを表示（一覧トレイ）</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.showYomikataKanji}
                  onChange={() => toggle('showYomikataKanji')}
                />
                <span>地名の漢字表示（読み方用）</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.reverseJumpButtons}
                  onChange={() => toggle('reverseJumpButtons')}
                />
                <span>地方移動ボタンを逆に並べる</span>
              </label>
            </div>
          </section>

          <section className="config-section">
            <h4>完了時アクション</h4>
            <div className="config-grid">
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.fixActionSound}
                  onChange={() => toggle('fixActionSound')}
                />
                <span>サウンド</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.fixActionVibration}
                  onChange={() => toggle('fixActionVibration')}
                />
                <span>バイブレーション</span>
              </label>
            </div>
          </section>

          <section className="config-section">
            <h4>名称表示（パズル／地図）</h4>
            <div className="config-grid">
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.nameInList}
                  onChange={() => toggle('nameInList')}
                />
                <span>リスト収納時</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.nameOnDrag}
                  onChange={() => toggle('nameOnDrag')}
                />
                <span>ドラッグ中</span>
              </label>
              <label className="config-check">
                <input
                  type="checkbox"
                  checked={config.nameOnFix}
                  onChange={() => toggle('nameOnFix')}
                />
                <span>完了時</span>
              </label>
            </div>
          </section>

          <section className="config-section">
            <h4>操作チューニング</h4>
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
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
