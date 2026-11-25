# 設計書：全国市区町村パズル＆地理クイズ アーキテクチャ設計（v2.0.3）

## 1. システム全体構成

React 19 + TypeScript (Vite) によるクライアントサイド SPA 構成とし、外部バックエンドに依存せずブラウザのみで全機能が完結する日本専門の地理学習アプリケーションとする。高精細な地図ベクターデータはサイズ最適化（座標量子化・トポロジーマージ済み JSON）の上、`public/data/` 配下に静的アセットとして配置し、モード開始時に必要な単位で高速フェッチ・キャッシュする。

```text
municipality-game/
├── docs/
│   ├── requirements.md            # 要件定義書
│   └── design.md                  # 本設計書
├── scripts/
│   ├── build_map_data.py          # N03-21 TopoJSON + 統計CSV統合ジェネレータ（日本都道府県・市区町村）
│   ├── fetch_rivers.py            # OpenStreetMap 主要16河川 実測流路ビルダー
│   ├── fetch_lakes.py             # OpenStreetMap 主要22湖沼 実測ポリゴンビルダー
│   ├── build_plains.py            # 国土地理院DEM標高タイル＋陸地クリップ 主要17平野ビルダー
│   ├── build_mountains.py         # 国土地理院DEM等 主要24山脈・21山ビルダー
│   └── rebuild_geography_100.py   # 自然地理100選 統合アセンブラ
├── public/
│   └── data/
│       ├── japan_prefs.json       # 日本47都道府県 SVGパス + 統計 + 県庁座標 + インセット情報
│       ├── geography_100.json     # 日本の自然地理100件 (山脈24・山21・河川16・平野17・湖22)
│       └── muni/
│           ├── index.json         # 全1,747市区町村メタデータ(うち792市・人口・面積・郡・地域区分・Wiki)
│           └── all_paths.json     # 全1,747市区町村の統合済み高精度SVGパス(北海道・都島しょ調整済)
├── src/
│   ├── version.ts                 # APP_VERSION / APP_VERSION_LABEL ('v2.0.3', package.json と同期)
│   ├── types/
│   │   └── game.ts                # GameModeId, QuizChoiceLayout, HintAreaOverlay, SaveSlot, ConfigState 等
│   ├── data/
│   │   ├── gameCatalog.ts         # 日本・都道府県(47)・市区町村・市(全国/地方別)・自然地理の全モード定義
│   │   ├── prefColors.ts          # 隣接都道府県が同色にならない低彩度5色カラーリング定義
│   │   └── similarNames.ts        # 「似た名前」グループ辞書
│   ├── services/
│   │   ├── mapDataLoader.ts       # japan_prefs / muni (全市区町村・市フィルタ) / geography_100 キャッシュ付ローダー
│   │   ├── storageService.ts      # AutoSave / ManualSave / ClearRecords / Mistakes / Tags / Config 永続化
│   │   ├── soundService.ts        # Web Audio API による効果音 (はめ込み鐘・正解・不正解・UIクリック) & 振動
│   │   └── dataAnalyzer.ts        # DataTable 11タブ (漢字・ひらカナ・文字数・まち/ちょう・むら/そん・似た名前等) 集計
│   ├── hooks/
│   │   └── useMapViewport.ts      # 左クリックパン・慣性減衰・ズーム・地方ジャンプ・リアルタイム座標変換フック
│   └── components/
│       ├── TitleScreen.tsx        # タイトル(リリースバージョン表示) / エリア選択4タブ / GameInfo / カスタム / ランダム / その他
│       ├── MistakeReviewModal.tsx # 間違えた問題の記憶一覧・モード別/まとめ復習起動モーダル
│       ├── MapCanvas.tsx          # 白地図/標高図・低彩度隣接県塗り分け・県境オーバーレイ・県ホバーツールチップ・ヒント1/2描画
│       ├── GameSessionShell.tsx   # セッション統括・2段階ヒント制御・ポインティング座標連動・オートセーブ
│       ├── HudOverlay.tsx         # 共通ヘッダ(タイマー/Miss/ヒント回数/進捗/回答後名前トグル/Save/Menu/Back)・Zoom・地方移動・Info/Tag
│       ├── ConfigModal.tsx        # 全設定トグル(ポインティング選択肢・回答後名前表示等)＆スライダーモーダル
│       ├── PuzzleGame.tsx         # パズル本体(ピース一覧トレイ・ドラッグ＆ドロップ・スナップ判定・2段階ヒント)
│       ├── QuizGame.tsx           # 6択クイズ＋地理クイズ (下部表示 / 地図上ポインティング選択肢切替・2段階ヒント)
│       ├── YomikataGame.tsx       # 読み方モード＋県庁読み方 (キーボード入力 + 日本語IME Enter連続回答・2段階ヒント)
│       ├── ViewModeScreen.tsx     # 閲覧モード (日本/市区町村/全国市/47都道府県・隣接県塗り分け・県ホバーツールチップ)
│       ├── DataTableModal.tsx     # データ一覧モーダル (11種ソートタブ・地域フィルタ・検索・SubTable)
│       ├── TagManagerModal.tsx    # タグ管理モーダル (DataTable2: 作成・ロック・名前変更・削除・一覧)
│       ├── SaveSlotsModal.tsx     # 手動セーブ・上書き・ロード管理ダイアログ
│       └── ResultOverlay.tsx      # Complete紙吹雪 + スコア・NewRecord・誤答復習・完成図をみる・リトライ・シェア
└── ...
```

---

## 2. 白地図データ生成・座標設計

### 2.1 日本・市区町村データのトポロジー統合 (`scripts/build_map_data.py`)
1. **ソース**: 国土数値情報行政区域 N03-21 (`smartnews-smri/japan-topography` `s0010/N03-21_210101.json` および `prefectures.json`、MIT/CC0)。
2. **政令指定都市の区マージ**:
   - N03-21 は政令指定都市が行政区単位（例：`01101`〜`01110`）で分割されている一方、本アプリでは指定都市を1つの市ピース（例：`01100 札幌市`）として扱う。
   - Python ジェネレータで TopoJSON のアーク参照配列を走査し、同一指定都市内の区が双方向で共有する内部境界アークを除去し、外周アークのみを連結して 20 指定都市のシームレスな統合ポリゴンを生成する。
   - 平成30年市制施行によりコード変更された福岡県那珂川市 (`40231` ⇔ 旧 CSV `40305`) をコードマッピングし、全 1,747 市区町村（北方領土6村 `01695`〜`01700` 含む）を欠損ゼロで接続する。
3. **投影法・インセット配置**:
   - **全国日本地図ビュー**（`viewBox: 0 0 1000 1000`）：メルカトル投影で本州・北海道・九州・四国・北方領土を中央配置し、南西諸島（沖縄本島・先島諸島・大東諸島）を見やすいインセット枠に収める標準白地図レイアウト、かつ沖縄県単体モード時は実位置比率で全諸島を描画。
   - **東京都ビュー**（`13_tokyo`）：本土部に加え伊豆諸島・小笠原諸島を別インセットまたは全体視野に配置し、`島しょ部` 単独プレイ時は島しょ部中心にフレーミングする。

### 2.2 日本の自然地理100選 実測データ再構築 (`scripts/rebuild_geography_100.py`)
- 山脈・山地・高地（24件）、山（21件）、河川（16件）、平野（17件）、湖（22件）の全 100 件を、`build_map_data.py` と同一の日本メルカトル SVG 座標系へ実測データから再構築して `public/data/geography_100.json` を生成する。
  - **河川（16件）**: OpenStreetMap `waterway=river` リレーションから源流〜河口までの連続流路を抽出し、海岸線整合・Douglas-Peucker 簡素化を実施（`scripts/fetch_rivers.py`）。
  - **湖沼（22件）**: OpenStreetMap 湖沼ポリゴンから実形状を抽出（`scripts/fetch_lakes.py`）。
  - **平野（17件）**: 国土地理院 DEM 標高タイルと `japan_prefs.json` の厳密な陸地マスク交差により沖積平野ポリゴンを抽出（`scripts/build_plains.py`）。
  - **山脈・山地・高地（24件）＆山（21件）**: 国土地理院座標および標高データから尾根・山域ポリゴン／座標を生成（`scripts/build_mountains.py`）。

### 2.3 全国「市」専用マップのデータフィルタ設計 (`mapDataLoader.ts`)
- `public/data/muni/index.json`（全 1,747 市区町村）に対して `isCityMunicipality(m) = m.name.endsWith('市')` で全国 **792 市** を一貫抽出する（特別区23区・743町・189村を除外）。
- `regionFilter` により `cities_all`（全国792市）、`cities_Hokkaido`（北海道の市）、`cities_<地方キー>`（東北〜九州の7地方別）、`cities_custom`（カスタム選択県の市のみ）を高速生成する。
- 市専用マップ表示時、出題対象外の町村ポリゴンは `contextPieces` として残しつつ低彩度・低コントラストの周辺地形コンテキストとして描画することで、全国の海岸線と都道府県輪郭を保ったまま市の配置を学習できる。

---

## 3. コンポーネント＆状態遷移設計

### 3.1 コア状態管理 (`App.tsx`)
`AppView` は以下のユニオン型で管理し、画面遷移の不整合を防ぐ：
- `title`: タイトル画面（リリースバージョン `v2.0.3` 表示）＋サブモーダル（エリア選択4タブ、`GameInfo`、手動ロード、`カスタム`、`ランダム`、`間違えた問題復習`、`その他`）
- `play`: アクティブなプレイセッション（`puzzle` | `quiz` | `yomikata` | `geography_quiz`）
- `view`: 閲覧モード（＋ `DataTable`）

### 3.2 低彩度隣接県塗り分け＆都道府県ホバーツールチップ (`prefColors.ts`, `MapCanvas.tsx`)
- **隣接県5色パレット (`src/data/prefColors.ts`)**:
  - 47都道府県すべての陸地隣接ペアおよび主要海峡隣接ペア（北海道-青森、兵庫-徳島、岡山-香川、広島-愛媛、山口-福岡、和歌山-徳島、愛媛-大分等）で同色衝突が 0 件となるよう検証した低彩度5色パステルパレット（通常 `PREF_MUTED_PALETTE` / 周辺コンテキスト用 `PREF_MUTED_CONTEXT_PALETTE`）を採用する。
- **適用範囲**:
  - `isPrefGuessMode = spec.mapScope === 'japan_prefs' && !spec.geoCategory` を判定し、県当てモード以外（市区町村・市・県庁所在地・自然地理100選・閲覧モード）では `enablePrefTint={true}`・`enablePrefHoverTooltip={true}` を有効化する。
  - 市区町村・市マップ上では `config.showBorder` 有効時に `strokeOnly` の県境オーバーレイ（`vectorEffect="non-scaling-stroke"`、沖縄インセット内も対応）を最前面へ重ねて県境視認性を高める。
- **ゼロ再レンダリング・ホバーツールチップ**:
  - 各都道府県背景 `<path>` およびピース `<path>` に `data-pref-name` を付与し、`onPointerMove` 内で `document.elementsFromPoint(clientX, clientY)` によりカーソル直下の県名を取得する。
  - React の `setState` を一切起こさず `ref` 経由で `.pref-hover-tooltip` の `textContent`・`transform`・`opacity` を直接更新することで、全国 1,747 市区町村描画中でも 60fps の軽快さを維持する。

### 3.3 2段階ヒントシステム＆ヘッダー操作 (`GameSessionShell.tsx`, `HudOverlay.tsx`, `MapCanvas.tsx`)
- **ズーム連動設計**: ヒント1実行時は `focusHintAreaSmooth` で「この辺」サークル全体が収まる範囲へスムーズにズームインし、ヒント2実行時は `focusPieceSmooth` で当てはめ対象の場所へズームインする。
- **ヒント1 (`hintStage = 1`, `HintAreaOverlay`)**:
  - マップ幅とピースサイズから適切な大半径を算出し、`piece.id` に基づく決定的オフセット角度で対象ピースを内包する「ヒント1：この辺」点線サークルを描画し、その円全体が見える倍率へズームインする。
  - クイズでは決定的に誤答選択肢を2つ除外（`.is-hint-eliminated`）、読み方では頭文字ヒントを表示。
- **ヒント2 (`hintStage = 2`, `hintFittedPieceId`)**:
  - 対象オブジェクトを地図上の実位置でエメラルド強調＋パルスリング（`.hint-fitted-pulse`）表示し、`config.nameOnFix` の状態に関わらず対象名を一時明示する。
  - パズルでは即座に配置完了、クイズでは正解選択肢を `.is-hint-correct` 強調後に自動配置・進行、読み方では入力欄へ正解読みをセット。
- **ヘッダー HUD (`HudOverlay.tsx`)**:
  - `Miss` の横に `ヒント` 使用回数（`.hud-hint-val`）を表示。
  - `.hud-actions-group` に `🏷 回答後の名前: ON/OFF`（`.hud-toggle-btn`）を配置し、`config.nameOnFix` をワンクリックで反転・即時反映する。

### 3.4 クイズ地図上ポインティング選択肢レイアウト (`QuizGame.tsx`, `useMapViewport.ts`)
- `ConfigState.quizChoiceLayout`（`'bottom' | 'pointing'`、デフォルト `'pointing'`）を保持し、クイズ下部バーおよび `ConfigModal` から即時切替できる。
- `useMapViewport` の `onLiveViewBoxChange` と `svgToContainerPoint` により、ドラッグパン・ホイールズーム・慣性減衰・リサイズ中の各フレームで画面座標へ再投影する。
- ポインティングモード時は：
  - 対象アンカー座標（河川の場合は `linePts` 上で `center` に最も近い点）を算出し、左右各3枚の選択肢カード（`.quiz-pointing-card`）を対象バウンディングボックスの外側へ配置。
  - 画面端に近い場合は反対側カラムへ自動シフト・クランプし、全カード間の重なり 0 件かつビューポート内収容を保証する。
  - `.quiz-pointing-lines` SVG レイヤーに白縁取り付きのリーダー線とアンカー点を描画し、下部操作バーは `.quiz-pointing-bar` としてスリム表示する。

### 3.5 パズルのドラッグ＆スナップ設計
- **ドラッグ処理**: Pointer Events (`onPointerDown` / `onPointerMove` / `onPointerUp` + `setPointerCapture`) を使用し、マウス・トラックパッド・タッチに統一対応。
- **ドラッグ中UI**:
  - 下部トレイからドラッグ開始したピースの実寸シルエットをポインタ上部に追従描画し、設定 `名称表示 > ドラッグ中` に応じて地名ラベルを表示。
  - ピースドラッグ中に地図の自動スクロールは発動せず、マップ移動は Google マップ同様の左クリックドラッグ／ホイールズームで自由に行える。
  - ポインタ位置を地図SVG座標へ逆変換し、正解ピースのポリゴン包含判定（`data-piece-id`）または基準重心との距離（スクリーン換算しきい値 px）を満たした状態でドロップすると正解判定。

### 3.6 読み方キーボード入力設計 (`YomikataGame.tsx`)
- 画面下部のテキスト入力欄へ出題ごとに自動フォーカスし、キーボードだけで連続解答できる設計とする。
- `onCompositionStart` / `onCompositionEnd` により日本語 IME の変換確定を正確に判定し、IME 確定時に入力値が正解と一致した場合は即座に正解・次問へ遷移する。
- 非変換時の Enter キーで正誤判定し、誤答時は赤フィードバック＋入力テキスト全選択として即座に打ち直せるようにする。空文字での Enter は誤爆ミス防止のため無視する。

### 3.7 DataTable 11タブ解析エンジン (`dataAnalyzer.ts`)
- 各タブのロジック：
  1. `市町村`: `code` 昇順。
  2. `50音`: `reading` 昇順 (`localeCompare('ja')`)。
  3. `人口`: `population` 降順（北方領土等0人は末尾）。
  4. `面積`: `areaKm2` 降順。
  5. `漢字`: 対象エリア内の全団体名から一文字ずつ漢字 (`[\u4E00-\u9FFF\u3400-\u4DBF々]`) を抽出し、使用回数の多い順に集計。タップで該当漢字を含む団体リストを `SubTable` 表示。
  6. `ひらカナ`: 団体名にひらがな（`\u3041-\u3096`）またはカタカナ（`\u30A1-\u30F6ー`）が含まれる団体を抽出し、「ひらがな」「カタカナ」「混在」別および団体一覧で表示。
  7. `文字数`: 漢字表記文字数（例：2文字〜7文字）ごとに件数集計し、クリックで該当団体を `SubTable` 表示。
  8. `似た名前`: 同名・同音・類似地名辞書を表示し、グループクリックで所属自治体を `SubTable` 表示＋地図上比較確認可能。
  9. `まち・ちょう`: 「〜町」の読み末尾（`まち` vs `ちょう` vs その他）の全件数比率および都道府県別分布。クリックで詳細一覧表示。
  10. `むら・そん`: 「〜村」の読み末尾（`むら` vs `そん`）の全件数比率および都道府県別分布。
  11. `市町村区`: `市` / `町` / `村` / `区` の件数・割合集計＋一覧。

---

## 4. セキュリティ・アクセシビリティ・テスト計画

- 外部通信は Wikipedia 外部リンク（`rel="noopener noreferrer"`、新規タブ）および任意シェアリンクのみとし、ユーザーデータはローカル保存に限定する。
- 全自動検証として、以下を完了時に実行する：
  1. **データ整合性検証**: 47都道府県、1,747市区町村（うち792市）、100自然地理データの ID・SVGパス存在・座標範囲（NaN/空パス 0件）、および隣接47都道府県5色パレットの無衝突を検証。
  2. **型・ビルド・Lint 検証**: `npm run build` (`tsc -b && vite build`) および `npm run lint` (`eslint .`) が 0 errors / 0 warnings で通ること。
  3. **UI・描画実機確認**: タイトル画面（バージョン表示）・白地図表示（全国日本・全国市・東京・自然地理100選）・パズル・クイズ（下部／ポインティング選択肢）・2段階ヒント・都道府県ホバーツールチップ・回答後地名表示トグル・読み方・閲覧/データ11タブ・設定がエラーなく表示・操作できることを確認する。
