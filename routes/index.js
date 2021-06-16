var express = require('express');
var router = express.Router();
var DeploymentRoute = require('./deployment/deployment.route.js');


router.use('/deployment',DeploymentRoute)


module.exports = router;
