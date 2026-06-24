MESH ブロックを BLE 直結で使う、Logic PK 用の競技進行・判定システムです。  
MESH アプリは必須ではありません。RED 画面、BLUE 画面、スマホ用スコア画面の 3 系統で運用します。

## 画面

- RED 画面
  - setup 中は管理画面
  - 試合開始後は RED チーム画面
- BLUE 画面
  - setup 中は待機表示
  - 試合開始後は BLUE チーム画面
- スマホ用スコア
  - 現在スコアだけを誰でも見られる公開画面

開く URL:

- RED: `http://localhost:5173/team/red`
- BLUE: `http://localhost:5173/team/blue`
- SCORE: `http://localhost:5173/score`

スマートフォンからは `localhost` ではなく、Vite 起動時に出る `Network` URL に `/score` を付けて開いてください。

## 必要な MESH ブロック

- 明るさセンサー 1 個
- RED 用ボタン 2 個
- BLUE 用ボタン 2 個
- 審判用ボタン 1 個

BLE 上の論理 role は次の 6 つです。

- `goalSensor`
- `redCycle`
- `redConfirm`
- `blueCycle`
- `blueConfirm`
- `refereeControl`

各チームボタンは押し方の違いを見ません。単押し・ダブルクリック・長押しのどれでも同じ役割です。

- `Cycle`: 候補送り
- `Confirm`: 確定

審判ボタンだけは押し方を使い分けます。

- 単押し: レビュー項目移動
- ダブルクリック: レビュー項目の値変更 / 投球中は詳細判定へ移行
- 長押し: 次のステージへ進む、または確定

## 競技ルール

### 試合前

- 各チームの人数は同じでなければならない
- 各選手の基礎点は整数 `1` 以上
- 各チームの基礎点合計は `ceil(人数 × 2.5)`
- setup 後、各チームは `5 分` で投球順を決める

### 1 ターンの流れ

1. 投球順が確定したら、審判長押しでターン選択を開始する
2. 投げる側は距離を選ぶ
   - `1m` 単位
   - 選択時間 `10 秒`
3. 投げない側は追加得点権を選ぶ
   - 選択時間 `10 秒`
   - `10 秒` 経過時点で自動確定
   - 既に確定済みの項目を優先し、未確定なら現在の候補を採用し、候補もなければランダム補完
4. 審判長押しで選択確認
5. 審判長押しでもう一度進めると投球開始
6. 投球時間は `20 秒`
7. 投球後は結果画面を出す
   - どちらの権利を使ったか
   - 今回の加点
   - 反則 / 失格
8. 審判長押しで次のターンへ進む

### 距離点

- 成功時、投球者の基礎点が入る
- `距離点権` を使った場合、その距離 `m` がそのまま加点される

### 追加得点権

各チームは、自チーム人数ぶんだけ自分の権利を持ちます。  
権利が `0` になった向きは選べません。

- `distance`
  - 投げる側が自分の距離点権を使う
  - 投げる側に距離点が入る
- `opponentAverage`
  - 投げない側が自分の平均基礎点権を使う
  - 投げない側に平均基礎点が入る

### 成功・失敗・無効

- 成功
  - センサーが閾値以下になった
- 失敗
  - 投球時間内に成功検知しなかった
- 無効
  - 審判レビューで無効判定にした

### 反則・失格

- 審判がレビュー画面で付与する
- 勝敗判定順
  1. 失格の有無
  2. 切り上げ後得点
  3. 実得点
  4. 反則数

### 延長戦

- 同点なら延長戦
- 結果画面で審判長押しすると延長戦を開始できる
- 選手の投球済みフラグだけをリセットし、同じ投球順を再利用する

## MESH 接続手順

初回またはブロックを入れ替えたとき:

```bash
npm run ble:stop
npm run ble:discover
npm run ble:register
npm run ble:check-config
```

通常起動:

```bash
npm run dev:with-ble
```

よく使う補助コマンド:

```bash
npm run ble:stop
npm run server:stop
npm run match:reset
```

## BLE 登録の考え方

`npm run ble:register` では、近くの MESH ブロックをスキャンして role を割り当てます。

推奨対応:

- `goalSensor` -> 明るさセンサー
- `redCycle` -> RED ボタン1
- `redConfirm` -> RED ボタン2
- `blueCycle` -> BLUE ボタン1
- `blueConfirm` -> BLUE ボタン2
- `refereeControl` -> 審判ボタン

`npm run ble:check-config` で role の欠けがないことを確認してください。

## センサー設定

- `minRaw` は `0` 固定で運用可能
- `emptyRaw` は空ゴール時の値
- `triggerThreshold` 以下で成功判定

setup 画面から次ができます。

- 自動キャリブレーション
- `minRaw = 0` 固定
- 現在値を空ゴール値として保存
- 手動保存

## 実行コマンド

```bash
npm install
npm run dev:with-ble
```

BLE を使わず画面だけ確認する場合:

```bash
npm run dev
```

型チェック:

```bash
npm run type-check
```

ビルド:

```bash
npm run build
```

## トラブルシュート

### `no MESH blocks found`

まず既存ブリッジを止めてから再探索してください。

```bash
npm run ble:stop
npm run ble:discover
```

それでも出ない場合:

- MESH アプリや他端末が接続中でないか確認
- ブロックの電源を入れ直す
- Mac の Bluetooth 権限を確認

### `mesh-ble.config.json が旧構成です`

role が足りていません。再登録してください。

```bash
npm run ble:register
npm run ble:check-config
```

### `Port 3000 is already in use`

既存サーバを再利用しているだけなら即問題ではありません。  
完全に止めたい場合:

```bash
npm run server:stop
```

### スコアだけ消したい

```bash
npm run match:reset
```

## 現在残している主要ファイル

- `server/`: API と試合ロジック
- `client/`: RED / BLUE / SCORE 画面
- `scripts/`: 起動・BLE 補助スクリプト
- `mesh-ble.config.example.json`: BLE 設定例
- `mesh-ble.config.json`: 現在使う BLE 設定
- `calibration.json`: センサー校正値
