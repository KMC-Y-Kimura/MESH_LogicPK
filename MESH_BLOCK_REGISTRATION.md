# MESH ブロック登録

## 1. 結論

今の Logic PK 実装では、通常変更するのは `mesh-ble.config.json` だけです。

## 2. 現在の登録対象

- `goalSensor`
- `redCycle`
- `redConfirm`
- `blueCycle`
- `blueConfirm`
- `refereeControl`

## 3. 自動登録

```bash
npm run ble:stop
npm run ble:register
```

流れ:

1. 近くの MESH ブロックをスキャン
2. `goalSensor` に使う明るさブロックを選ぶ
3. `redCycle` に使うボタンを選ぶ
4. `redConfirm` に使うボタンを選ぶ
5. `blueCycle` に使うボタンを選ぶ
6. `blueConfirm` に使うボタンを選ぶ
7. `refereeControl` に使うボタンを選ぶ
8. `mesh-ble.config.json` を保存

重要:

- 現在の Logic PK 実装では、`redCycle`, `redConfirm`, `blueCycle`, `blueConfirm`, `refereeControl` をそれぞれ別々の物理 MESH ボタンに割り当てる必要があります
- 同じ物理ボタンを複数の論理ボタンへ割り当てると、1 回の押下で複数コマンドが同時に飛ぶため、選択フェーズが壊れます
- そのため、ボタンブロックが 5 個未満しか見えていない状態では、この構成のままでは登録できません

## 4. 手動登録

`mesh-ble.config.example.json` をコピーし、各 `localName` を実機名へ書き換えます。

同じ物理ボタンには `single/double/long` の3エントリがありますが、いずれも同じ `buttonId` です。これにより、押し方によらず同じコマンドになります。

## 5. 差し替え時の判断

### 同じ種類の明るさブロックへ替える

- `goalSensor.localName` の変更だけ

### RED / BLUE / 審判ボタンを替える

- 対応する `localName` の変更だけ

### センサーを 2 個以上使いたい

- 現在の実装では非対応です

## 6. 登録後の確認

```bash
npm run dev:with-ble
```

確認点:

1. `goalSensor: connected`
2. 各ボタンが `connected`
3. 各ブロックが `ready`
4. `/api/state` の `sensor.latestRaw` が更新される
5. ボタン操作で `/team/red` `/team/blue` `/` の表示が変わる
