import { Router } from 'express';
import { jobSnapshot } from './docx-strategy.js';
import { researchPublicJob } from './research.js';
import {
  attachmentForDocx, createDocxReview, downloadDocxArtifact, exportDocxReview, getDocxReview, listDocxReviews,
} from './docx-service.js';

const router = Router();
const run = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

router.get('/reviews', run((req, res) => res.json({ reviews: listDocxReviews() })));
router.post('/research', run(async (req, res) => {
  res.json({ research: await researchPublicJob(jobSnapshot(req.body?.job), {
    useModel: req.body?.useModel === true, companyUrl: req.body?.companyUrl,
  }) });
}));
router.post('/reviews', run(async (req, res) => res.status(201).json(await createDocxReview(req.body))));
router.get('/reviews/:id', run((req, res) => res.json(getDocxReview(req.params.id))));
router.post('/reviews/:id/exports', run(async (req, res) => res.json(await exportDocxReview(req.params.id, req.body))));
router.get('/reviews/:id/versions/:version/file/:kind', run((req, res) => {
  const { data, filename } = downloadDocxArtifact(req.params.id, req.params.version, req.params.kind);
  res.attachment(filename).type(req.params.kind === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf').send(data);
}));
router.post('/reviews/:id/versions/:version/attachment', run((req, res) => {
  res.json(attachmentForDocx(req.params.id, req.params.version, req.body));
}));

export default router;
