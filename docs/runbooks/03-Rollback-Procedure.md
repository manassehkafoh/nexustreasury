# Runbook 03: Rollback Procedure

**When to use:** A production deployment has introduced a regression,
error rates have increased, or a critical bug has been identified post-deploy.

---

## Option A: ArgoCD Rollback (Recommended)

ArgoCD maintains full deployment history. This is the fastest path.

1. Open ArgoCD UI: `https://argocd.nexustreasury.com`
2. Find the `nexustreasury-production` application
3. Click **History and Rollback**
4. Find the last known-good deployment (use the timestamp)
5. Click **Rollback**
6. Monitor the deployment in ArgoCD until all pods are green

Total time: ~3–5 minutes.

---

## Option B: Kubernetes Rollback

```bash
# Check rollout history
kubectl rollout history deployment/trade-service -n nexus-prod

# Roll back to previous version
kubectl rollout undo deployment/trade-service -n nexus-prod

# Roll back to a specific version
kubectl rollout undo deployment/trade-service -n nexus-prod --to-revision=3

# Monitor rollback
kubectl rollout status deployment/trade-service -n nexus-prod

# Verify pods are running the previous image
kubectl get pods -n nexus-prod -l app=trade-service -o jsonpath='{.items[*].spec.containers[*].image}'
```

---

## Option C: Git Revert

If the bad code was merged to main and you want to prevent re-deployment:

```bash
git revert <bad-commit-hash>
git push origin main
# CI will run, then CD will deploy the reverted version
```

This is slower (~15–20 minutes including CI) but creates a clean audit trail.

---

## Database Rollback

If the deployment included a Prisma migration that needs to be reversed:

```bash
# Check migration status
kubectl exec -n nexus-prod trade-service-pod -- \
  pnpm exec prisma migrate status

# WARNING: Prisma does not support automatic rollback of migrations
# You must write a manual SQL script to reverse the migration
# Contact the database team and escalate immediately
```

**Prevention:** All migrations should be backwards-compatible (additive only).
Never drop columns in the same migration as adding new ones. Use a two-phase approach:

1. Deploy new code that reads both old and new columns
2. After confirming stability, deploy migration to drop the old column

---

## Confirmation

After rollback:

```bash
# Confirm error rate is back to baseline
# Grafana: trade-service → Error Rate → should be < 0.1%

# Test critical user flow
curl -X POST https://api.nexustreasury.com/api/v1/trades ...
# Should return 201

# Confirm all pods are on the reverted image
kubectl get pods -n nexus-prod -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}'
```
