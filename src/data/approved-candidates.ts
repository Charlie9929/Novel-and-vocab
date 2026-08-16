/**
 * Production candidate approvals are deliberately small and tuple-specific.
 * Every row has repeated development evidence, no validation keep conflict,
 * and a recorded Sol batch decision in the ignored local review artifact.
 * This file contains lexical metadata only—never a novel sentence or offset.
 */
export interface ApprovedCandidate {
  candidateId: string;
  evidence: "development>=2 + validation-negative-screen";
  solReview: "sol-candidate-promotion-review-v1";
}

export const APPROVED_CANDIDATES: readonly ApprovedCandidate[] = [
  { candidateId: "一半:half:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "内容:content:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "实际上:actually:adverb", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "意识到:realize:verb", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "注意到:notice:verb", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "标签:label:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "眼睛:eye:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "身体:body:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
  { candidateId: "系统:system:noun", evidence: "development>=2 + validation-negative-screen", solReview: "sol-candidate-promotion-review-v1" },
];

export const APPROVED_CANDIDATE_IDS = new Set(APPROVED_CANDIDATES.map((candidate) => candidate.candidateId));
