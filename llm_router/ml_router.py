"""ML 路由器 — 加载模型并预测每层安全概率."""

import json
import logging
from pathlib import Path
from typing import Optional

from .schemas import TierSafetyPrediction, FeatureSnapshot

logger = logging.getLogger("llm_router")


class MLRouter:
    """ML 路由器 — 加载模型并预测每层安全概率."""

    def __init__(self, config, tracker):
        self.config = config
        self.tracker = tracker
        self.enabled = config.ml_routing_config.get("enabled", False)
        self.manifest_path = config.ml_routing_config.get("manifest_path")

        # 模型组件（延迟加载）
        self._tier3_classifier = None
        self._tier2_classifier = None
        self._calibrator = None
        self._ood_detector = None
        self._manifest = None

        if self.enabled:
            self._load_models()

    def predict_safety(self, snapshot: FeatureSnapshot) -> Optional[TierSafetyPrediction]:
        """预测每层安全概率

        Args:
            snapshot: 特征快照

        Returns:
            TierSafetyPrediction 或 None（如果 ML 未启用）
        """
        if not self.enabled or not self._manifest:
            return None

        try:
            # 1. 准备特征向量
            feature_vector = self._prepare_feature_vector(snapshot)

            # 2. OOD 检测
            ood_result = self._check_ood(feature_vector)
            if ood_result["detected"]:
                return TierSafetyPrediction(
                    raw_probabilities={},
                    calibrated_probabilities={},
                    lower_confidence_bounds={},
                    ood_detected=True,
                    ood_reason=ood_result["reason"],
                )

            # 3. 获取原始概率
            raw_probs = {
                "tier3": self._predict_proba(self._tier3_classifier, feature_vector),
                "tier2": self._predict_proba(self._tier2_classifier, feature_vector),
                "tier1": 1.0,  # tier1 作为安全回退
            }

            # 4. 校准
            cal_probs = self._calibrate(raw_probs)

            # 5. 计算置信下限
            lcb = self._compute_lcb(raw_probs, cal_probs)

            return TierSafetyPrediction(
                raw_probabilities=raw_probs,
                calibrated_probabilities=cal_probs,
                lower_confidence_bounds=lcb,
                ood_detected=False,
            )

        except Exception as e:
            logger.warning(f"ML 预测失败: {e}")
            return None

    def _prepare_feature_vector(self, snapshot: FeatureSnapshot) -> list:
        """将 FeatureSnapshot 转换为模型输入向量."""
        # 基础特征
        features = [
            snapshot.estimated_tokens,
            snapshot.message_count,
            snapshot.user_message_count,
            snapshot.assistant_message_count,
            snapshot.code_block_count,
            snapshot.file_path_count,
            snapshot.stacktrace_count,
            snapshot.tool_count,
            snapshot.question_count,
            snapshot.max_tokens_requested,
            int(snapshot.stream_flag),
            snapshot.complexity_signal_count,
            snapshot.error_signal_count,
            snapshot.matched_rule_count,
            snapshot.hour_of_day_utc,
        ]

        # 健康度分数
        if snapshot.tier1_health_score is not None:
            features.append(snapshot.tier1_health_score)
        else:
            features.append(100.0)

        if snapshot.tier2_health_score is not None:
            features.append(snapshot.tier2_health_score)
        else:
            features.append(100.0)

        if snapshot.tier3_health_score is not None:
            features.append(snapshot.tier3_health_score)
        else:
            features.append(100.0)

        # Task type 编码
        task_types = ["debug", "implementation", "architecture", "analysis", "simple", "general"]
        for tt in task_types:
            features.append(1 if snapshot.task_type == tt else 0)

        # Baseline tier 编码
        baseline_tiers = ["tier1", "tier2", "tier3"]
        for bt in baseline_tiers:
            features.append(1 if snapshot.baseline_selected_tier == bt else 0)

        return features

    def _predict_proba(self, classifier, feature_vector: list) -> float:
        """预测概率."""
        import numpy as np
        X = np.array([feature_vector])
        proba = classifier.predict_proba(X)[0]
        # 返回正类概率
        return float(proba[1])

    def _calibrate(self, raw_probs: dict[str, float]) -> dict[str, float]:
        """等渗回归校准."""
        if not self._calibrator:
            return raw_probs

        cal_probs = {}
        for tier, raw_p in raw_probs.items():
            if tier in self._calibrator:
                calibrator = self._calibrator[tier]
                # calibrator 是 sklearn IsotonicRegression
                cal_p = float(calibrator.predict([raw_p])[0])
                cal_probs[tier] = max(0.0, min(1.0, cal_p))
            else:
                cal_probs[tier] = raw_p

        return cal_probs

    def _compute_lcb(
        self,
        raw_probs: dict[str, float],
        cal_probs: dict[str, float],
    ) -> dict[str, float]:
        """计算置信下限 LCB = p_cal - 1.96 * SE."""
        # 简化：假设 SE 与 sqrt(p*(1-p)/n) 成正比
        # n 是校准集大小，从 manifest 读取
        lcb = {}
        n_calibration = self._manifest.get("calibration_samples", 1000) if self._manifest else 1000

        for tier, cal_p in cal_probs.items():
            se = (cal_p * (1 - cal_p) / n_calibration) ** 0.5
            lcb[tier] = max(0.0, cal_p - 1.96 * se)

        return lcb

    def _check_ood(self, feature_vector: list) -> dict:
        """OOD 检测."""
        if not self._ood_detector:
            return {"detected": False, "reason": None}

        import numpy as np
        X = np.array([feature_vector])

        # 阶段 A: 特征范围检查
        feature_ranges = self._manifest.get("feature_ranges", {})
        ood_reasons = []

        for i, (name, value) in enumerate(zip(self._get_feature_names(), feature_vector)):
            if name in feature_ranges:
                p99 = feature_ranges[name]["p99"]
                if value > p99 * 1.2:
                    ood_reasons.append(f"{name} exceeds p99*1.2")

        if ood_reasons:
            return {
                "detected": True,
                "reason": f"特征范围: {', '.join(ood_reasons[:2])}",
            }

        # 阶段 B: 密度检测
        score = self._ood_detector.score_samples(X)[0]
        if score < -0.10:
            return {
                "detected": True,
                "reason": f"密度异常 (score={score:.3f})",
            }

        return {"detected": False, "reason": None}

    def _load_models(self):
        """加载模型组件."""
        manifest_path = Path(self.manifest_path)
        if not manifest_path.exists():
            logger.warning(f"ML 清单文件不存在: {self.manifest_path}")
            return

        with open(manifest_path) as f:
            self._manifest = json.load(f)

        try:
            import joblib
            import numpy as np

            # 加载分类器
            self._tier3_classifier = joblib.load(
                Path(self._manifest["tier3_classifier_path"])
            )
            self._tier2_classifier = joblib.load(
                Path(self._manifest["tier2_classifier_path"])
            )

            # 加载校准器
            calibrator_path = Path(self._manifest["calibrator_path"])
            if calibrator_path.exists():
                self._calibrator = joblib.load(calibrator_path)

            # 加载 OOD 检测器
            ood_path = Path(self._manifest["ood_detector_path"])
            if ood_path.exists():
                self._ood_detector = joblib.load(ood_path)

            logger.info(f"ML 模型加载成功: {self._manifest['model_id']}")

        except Exception as e:
            logger.error(f"ML 模型加载失败: {e}")
            self.enabled = False

    @staticmethod
    def _get_feature_names() -> list[str]:
        """返回特征名称列表（与 _prepare_feature_vector 对应）."""
        names = [
            "estimated_tokens",
            "message_count",
            "user_message_count",
            "assistant_message_count",
            "code_block_count",
            "file_path_count",
            "stacktrace_count",
            "tool_count",
            "question_count",
            "max_tokens_requested",
            "stream_flag",
            "complexity_signal_count",
            "error_signal_count",
            "matched_rule_count",
            "hour_of_day_utc",
            "tier1_health_score",
            "tier2_health_score",
            "tier3_health_score",
        ]
        task_types = ["debug", "implementation", "architecture", "analysis", "simple", "general"]
        names.extend([f"task_type_{tt}" for tt in task_types])
        baseline_tiers = ["tier1", "tier2", "tier3"]
        names.extend([f"baseline_tier_{bt}" for bt in baseline_tiers])
        return names
