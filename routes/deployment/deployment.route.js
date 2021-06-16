var express = require('express');
const router = express.Router();
var DeploymentController = require('../../controllers/deployment/deployment.controller');

router.post('/db/backup', DeploymentController.mongoBackup);
router.post('/db/restore', DeploymentController.mongoRestore);

router.post('/downalodSource', DeploymentController.downlaodSources);

module.exports = router;