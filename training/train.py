# 訓練 7 類棋子分類的小 CNN,匯出成 App 的純 TS 前向傳播權重格式。
# 架構必須與 src/vision/cnn.ts 完全一致:
#   conv3x3(1→16) relu pool2 → conv3x3(16→32) relu pool2 → conv3x3(32→64) relu pool2 → fc(2304→7)
# 匯出:'XQP1' + conv1 W/b + conv2 W/b + conv3 W/b + fc W/b(float32 LE)
# 另存一個 Python↔TS 一致性 fixture(輸入 + 機率),給 vitest 驗前向傳播實作。
import json
import os
import struct

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "data")


class Net(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.c1 = nn.Conv2d(1, 16, 3, padding=1)
        self.c2 = nn.Conv2d(16, 32, 3, padding=1)
        self.c3 = nn.Conv2d(32, 64, 3, padding=1)
        self.fc = nn.Linear(64 * 6 * 6, 7)
        self.pool = nn.MaxPool2d(2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.pool(torch.relu(self.c1(x)))
        x = self.pool(torch.relu(self.c2(x)))
        x = self.pool(torch.relu(self.c3(x)))
        return self.fc(torch.flatten(x, 1))


def main() -> None:
    torch.manual_seed(0)
    xt = torch.from_numpy(np.load(f"{DATA}/x_train.npy"))
    yt = torch.from_numpy(np.load(f"{DATA}/y_train.npy"))
    xv = torch.from_numpy(np.load(f"{DATA}/x_val.npy"))
    yv = torch.from_numpy(np.load(f"{DATA}/y_val.npy"))
    print("train", xt.shape, "val", xv.shape, flush=True)

    net = Net()
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    lossf = nn.CrossEntropyLoss()
    loader = DataLoader(TensorDataset(xt, yt), batch_size=128, shuffle=True)

    best_acc = 0.0
    best_state = None
    for epoch in range(12):
        net.train()
        for xb, yb in loader:
            opt.zero_grad()
            loss = lossf(net(xb), yb)
            loss.backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            acc = (net(xv).argmax(1) == yv).float().mean().item()
        print(f"epoch {epoch}: val acc {acc:.4f}", flush=True)
        if acc > best_acc:
            best_acc = acc
            best_state = {k: v.clone() for k, v in net.state_dict().items()}

    assert best_state is not None
    net.load_state_dict(best_state)
    net.eval()
    print(f"best val acc {best_acc:.4f}", flush=True)

    # 每類準確率(誠實記錄:哪類最弱)
    with torch.no_grad():
        pred = net(xv).argmax(1)
    for ci, cls in enumerate(["K", "A", "B", "N", "R", "C", "P"]):
        m = yv == ci
        print(f"  class {cls}: {(pred[m] == yv[m]).float().mean().item():.4f}", flush=True)

    # 匯出權重
    out = bytearray()
    out += b"XQP1"
    def dump(t: torch.Tensor) -> None:
        out.extend(t.detach().numpy().astype("<f4").tobytes())
    for layer in [net.c1, net.c2, net.c3]:
        dump(layer.weight)
        dump(layer.bias)
    dump(net.fc.weight)
    dump(net.fc.bias)
    model_dir = os.path.join(HERE, "..", "public", "models")
    os.makedirs(model_dir, exist_ok=True)
    path = os.path.join(model_dir, "piece-cnn.bin")
    with open(path, "wb") as f:
        f.write(out)
    print(f"wrote {path} ({len(out)} bytes)", flush=True)

    # Python↔TS 一致性 fixture:一個真實 val 樣本 + 期望機率
    i = 7  # 任選
    x0 = xv[i : i + 1]
    with torch.no_grad():
        probs = torch.softmax(net(x0), dim=1)[0].numpy().tolist()
    fixture = {
        "input": xv[i, 0].numpy().round(5).flatten().tolist(),
        "expectedProbs": [round(p, 6) for p in probs],
        "label": int(yv[i].item()),
    }
    fx_path = os.path.join(HERE, "..", "src", "vision", "cnn.fixture.json")
    with open(fx_path, "w") as f:
        json.dump(fixture, f)
    print(f"wrote {fx_path}", flush=True)
    print("magic check:", struct.unpack(">I", bytes(out[:4]))[0] == 0x58515031, flush=True)


if __name__ == "__main__":
    main()
