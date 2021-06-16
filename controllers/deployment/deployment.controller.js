var express = require('express');
var fs = require('fs');
var path = require('path');
const https = require('https')
const unzipper = require('unzipper');
file = __dirname + '/../../config/config.json',
config = JSON.parse(fs.readFileSync(file));
var axios = require('axios'); 
var exec = require('child_process').exec;
const Mongo = require('mongodb').MongoClient;
const env = config.nodeconfig.env;
const extract = require('extract-zip')

async function getMongoConnections(subParentTenant,database) {
    try {
        
        let connectionUrl;
        if (subParentTenant) {            
            var response = {};
            var validToken = await getToken();
            if (validToken && validToken.result == 'OK' && validToken.token) {
                var postData = {"input": {"docType": "object", "configItemId": "mongo01", "docId": "azobject", "theme": subParentTenant}};
                var url = config.environment[env].docRouteUrl;
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': validToken.token
                };
                response = await axios.post(url, postData, {headers: headers});
                if (response && response.data && response.data.result && response.data.result.props) {
                  
                    let splitUrl = response.data.result.props.host.split(`/${database}`);
                    
                    connectionUrl = splitUrl[0]
                    
                }
            } else {
                if( config.environment[env].mongoDB && config.environment[env].mongoDB.host){                
                    connectionUrl = `mongodb+srv://${config.environment[env].mongoDB.user}:${config.environment[env].mongoDB.pass}@${config.environment[env].mongoDB.host}`
                }
            }
        }else {
            if( config.environment[env].mongoDB && config.environment[env].mongoDB.host){                
                connectionUrl = `mongodb+srv://${config.environment[env].mongoDB.user}:${config.environment[env].mongoDB.pass}@${config.environment[env].mongoDB.host}`
            }
        }
        
        return connectionUrl;
    } catch (ex) {
       
       console.log({ex})
    }

}

async function getToken() {
    var validToken = null;
    try {
        var postData = config.environment[env].tokenReq;
        var url = config.environment[env].tokenUrl;
        
        const response = await axios.post(url, postData);       
        if (response && response.data) {
            if (typeof response.data === "object") {
                validToken = eval('(' + JSON.stringify(response.data) + ')');
            } else {
                validToken = eval('(' + response.data + ')');
            }
        }       
    }
    catch (ex) {
        console.log({ex})    
    }
    return validToken;
}

let DeploymentController = {

    async mongoBackup(req,res,next){        
        let reqData = {
            isDatabseBackup: req.body.isDatabseBackup,
            collections: req.body.collections,
            version: req.body.version,
            database: req.body.database
        }
        
        if(!reqData.database){
            return res.status(400).json({
                data: {},
                message:"Database is required",
                error: {}
            })
        }
        if(!reqData.version){
            return res.status(400).json({
                data: {},
                message:"Version is required",
                error: {}
            })
        }
        let connectionUrl = await getMongoConnections(req.body.subParentTenant,reqData.database);
        
        let mongoConnectionBackupUrl = connectionUrl;        
        let mongoConnectionRestoreUrl = connectionUrl;

        let today = new Date()
        if(reqData.isDatabseBackup){
            try {
                let backupDbName = `${reqData.database}_${reqData.version}`
                let outPath = path.join(__dirname, `../../backup/database/${backupDbName}`)
                var cmd = `mongodump --uri=${mongoConnectionBackupUrl}/${reqData.database} --out=${outPath}`
                
                exec(cmd, async function (error, stdout, stderr) {
                    
                    if (error) {
                        return res.status(400).send(error)
                    }
                
                    var restoreDataCMD = `mongorestore --uri=${mongoConnectionRestoreUrl} ${outPath}`
                    
                    await exec(restoreDataCMD,{maxBuffer: 1024 * 1024 * 20},async function (error, stdout, stderr) {
                        console.log({error})
                        if(error) {
                            return res.status(400).send(error)
                        }else{
                            let removePath = path.join(__dirname, `../../backup/database`)
                            let removeFolderUrl = `sudo rm -r ${removePath}`
                            await exec(removeFolderUrl, function (err) { console.log({err})});
                            return res.status(200).send("success")
                            
                        }
                    })
                
                });
            } catch(err){
                let removePath = path.join(__dirname, `../../backup/database`)
                let removeFolderUrl = `sudo rm -r ${removePath}`;
                await exec(removeFolderUrl, function (err) { console.log({err})});
                return res.status(200).send(err)
            }
    
        } else {
            if(!reqData.collections || reqData.collections.length == 0){
                return res.status(400).json({
                    data: {},
                    message:"collections is required",
                    error: {}
                })
            }

            let backCollections;
            try {
                let count = 0;
                let currentCount = 0;
                let collectionLength = reqData.collections.length;
                let subName = `_${reqData.version}`
                let backupDbName = `${reqData.database}${subName}`
                let outPath = path.join(__dirname, `../../backup/collections/${backupDbName}`)
    
                backCollections = setInterval(async () => {
                   
                    if(count === currentCount && count < collectionLength){
                        
                        var cmd = `mongodump --uri=${mongoConnectionBackupUrl}/${reqData.database} -c=${reqData.collections[count]} --out=${outPath}`
                    
                        exec(cmd, async function (error, stdout, stderr) {                        
                            console.log({error})
                            if (error) {
                                return res.status(400).send(error)
                            }
                            let bsonChangeCmd = `mv ${outPath}/${reqData.database}/${reqData.collections[count]}.bson ${outPath}/${reqData.database}/${reqData.collections[count]}${subName}.bson`
                            let jsonChangeCmd = `mv ${outPath}/${reqData.database}/${reqData.collections[count]}.metadata.json ${outPath}/${reqData.database}/${reqData.collections[count]}${subName}.metadata.json`
                            
                            
                            await exec(bsonChangeCmd, function (err) { 
                                if(err) {
                                    return res.status(400).send(err)
                                }
                            });
                            await exec(jsonChangeCmd, function (err) { 
                                if(err) {
                                    return res.status(400).send(err)
                                }
                            });
                            
    
                            let restorDB = `mongorestore --uri=${mongoConnectionRestoreUrl}/${reqData.database} --drop --collection=${reqData.collections[count]}${subName} ${outPath}/${reqData.database}/${reqData.collections[count]}${subName}.bson`
                            console.log({restorDB})
                            await exec(restorDB, function (err) { 
                                console.log({err})
                                if (err) {
                                    return res.status(400).send(err)
                                } else {
                                    count ++;
                                }
                                
                            });
                            
                           
                        });
                        currentCount ++;
                    } 
                    
                    if(count >= collectionLength){
                        clearInterval(backCollections);
                        let removePath = path.join(__dirname, `../../backup/collections`)
                        let removeFolderUrl = `sudo rm -r ${removePath}`
                        let removeCollections = await exec(removeFolderUrl, function (err) { console.log({err})});
                        return res.status(200).send("success")
                    }
    
                },5000)
            } catch (err){
                clearInterval(backCollections);
                let removePath = path.join(__dirname, `../../backup/collections`)
                let removeFolderUrl = `sudo rm -r ${removePath}`
                let removeCollections = await exec(removeFolderUrl, function (err) { console.log({err})});
                return res.status(400).send(err)
            }
            
            
        }
        
    },
    async mongoRestore(req,res,next){
        
        let reqData = {
            isDatabseRestore: req.body.isDatabseRestore,
            collections: req.body.collections,
            version: req.body.version,
            database: req.body.database
        }
        
        if(!reqData.database){
            return res.status(400).json({
                data: {},
                message:"Database is required",
                error: {}
            })
        }
        if(!reqData.version){
            return res.status(400).json({
                data: {},
                message:"Version is required",
                error: {}
            })
        }

        let connectionUrl = await getMongoConnections(req.body.subParentTenant,reqData.database);
       
        let mongoConnectionUrl= connectionUrl;    
        let mongoConnectionBackupUrl = connectionUrl;            
        let mongoConnectionRestoreUrl = connectionUrl;
        
        
        let mongoConnection;
        mongoConnection = await Mongo.connect(mongoConnectionUrl);
        if(mongoConnection){

        }
        if(reqData.isDatabseRestore){           
            let adminDb = await mongoConnection.db().admin()
            let getDabase = await adminDb.listDatabases();
            
            let mapAllDatabase = getDabase.databases.map((data) => {return data.name})
            
            if(mapAllDatabase.includes(`${reqData.database}_${reqData.version}`)){
                let backupDbName = `${reqData.database}_backup`
                let outPath = path.join(__dirname, `../../backup/database/${backupDbName}`)
                var cmd = `mongodump --uri=${mongoConnectionBackupUrl}/${reqData.database} --out=${outPath}`
                
                exec(cmd, async function (error, stdout, stderr) {
                    
                    if (error) {
                        return res.status(400).send(error)
                    }
                    let renameDb = `mv ${outPath}/${reqData.database} ${outPath}/${reqData.database}_backup`;
                    await exec(renameDb,{maxBuffer: 1024 * 1024 * 50}, function (err) { 
                        if(err) {
                            return res.status(400).send(err)
                        }
                    });

                    var restoreDataCMD = `mongorestore --uri=${mongoConnectionRestoreUrl} ${outPath}`
                    console.log({restoreDataCMD})
                    await exec(restoreDataCMD,{maxBuffer: 1024 * 1024 * 50},async function (error, stdout, stderr) {
                        console.log({error})
                        if(error) {
                            return res.status(400).send(error)
                        }else{
                           
                            
                            let restoreDbName = `${reqData.database}`
                            let restoreOutPath = path.join(__dirname, `../../backup/database/${restoreDbName}`)
                            var cmd = `mongodump --uri=${mongoConnectionBackupUrl}/${reqData.database}_${reqData.version} --out=${restoreOutPath}`
                            
                            exec(cmd, async function (error, stdout, stderr) {
                                
                                if (error) {
                                    return res.status(400).send(error)
                                }
                            
                                let renameRestoreDb = `mv ${restoreOutPath}/${reqData.database}_${reqData.version} ${restoreOutPath}/${reqData.database}`;
                                await exec(renameRestoreDb, function (err) { 
                                    if(err) {
                                        return res.status(400).send(err)
                                    }
                                });

                                var restoreDataCMD = `mongorestore --uri=${mongoConnectionRestoreUrl} ${restoreOutPath}`
                                
                                await exec(restoreDataCMD,{maxBuffer: 1024 * 1024 * 50},async function (error, stdout, stderr) {
                                    
                                    if(error) {
                                        let renameDb = `mv ${outPath}/${reqData.database}_backup ${outPath}/${reqData.database}`;
                                        await exec(renameDb,{maxBuffer: 1024 * 1024 * 50}, function (err) { 
                                            if(err) {
                                                return res.status(400).send(err)
                                            }
                                        });
                                        var restoreDataCMD = `mongorestore --uri=${mongoConnectionRestoreUrl} ${outPath}`
                                        
                                        await exec(restoreDataCMD,{maxBuffer: 1024 * 1024 * 50},async function (err, stdout, stderr) {
                                            
                                            if(err) {
                                                return res.status(400).send(err)
                                            }else{
                                                let removePath = path.join(__dirname, `../../backup/database`)
                                                let removeFolderUrl = `sudo rm -r ${removePath}`
                                                await exec(removeFolderUrl, function (err) { console.log({err})});
                                                
                                                if(mongoConnection){
                                                    await mongoConnection.close();
                                                }
                                                return res.status(400).send(error)
                                            }
                                        })
                                        
                                    }else{
                                        let removePath = path.join(__dirname, `../../backup/database`)
                                        let removeFolderUrl = `sudo rm -r ${removePath}`
                                        await exec(removeFolderUrl, function (err) { console.log({err})});
                                        
                                        if(mongoConnection){
                                            await mongoConnection.close();
                                        }
                                        return res.status(200).send("success")
                                        
                                    }
                                })
                            
                            });

                        }
                    })
                
                });
            }

           
        } else{
            if(!reqData.collections || reqData.collections.length == 0){
                return res.status(400).json({
                    data: {},
                    message:"collections is required",
                    error: {}
                })
            }
            
        
            try {
               
                let db = await mongoConnection.db(reqData.database);
                let getAllCollections = await db.listCollections().toArray();
                
                let mapAllCollection = getAllCollections.map((data) => {return data.name})
    
                let count = 0;
                let currentCount = 0;
                let collectionLength = reqData.collections.length;
                let backupSubName = `_backup`
                let subName = `_${reqData.version}`
                let backupDbName = `${reqData.database}${subName}`
                let outPath = path.join(__dirname, `../../backup/collections/${backupDbName}`)
    
                let issueCollections = [];
                
                let backCollections = setInterval(async () => {
                   
                    if(count === currentCount && count < collectionLength){
                        if(mapAllCollection.includes(`${reqData.collections[count]}_${reqData.version}`)){
                            await db.renameCollection(`${reqData.collections[count]}`,`${reqData.collections[count]}${backupSubName}`,{dropTarget: true});
                
                            var cmd = `mongodump --uri=${mongoConnectionBackupUrl}/${reqData.database} -c=${reqData.collections[count]}_${reqData.version} --out=${outPath}`                
                            
                            exec(cmd, async function (error, stdout, stderr) {                        
                                
                                if (error) {
                                    return res.status(400).send(error)
                                }
                                let bsonChangeCmd = `mv ${outPath}/${reqData.database}/${reqData.collections[count]}_${reqData.version}.bson ${outPath}/${reqData.database}/${reqData.collections[count]}.bson`
                                let jsonChangeCmd = `mv ${outPath}/${reqData.database}/${reqData.collections[count]}_${reqData.version}.metadata.json ${outPath}/${reqData.database}/${reqData.collections[count]}.metadata.json`
                                
                                
                                await exec(bsonChangeCmd,async function (err) { 
                                    if(err) {
                                        await db.renameCollection(`${reqData.collections[count]}${backupSubName}`,`${reqData.collections[count]}`,{dropTarget: true});
                                        return res.status(400).send(err)
                                    }
                                });
                                await exec(jsonChangeCmd, async function (err) { 
                                    if(err) {
                                        await db.renameCollection(`${reqData.collections[count]}${backupSubName}`,`${reqData.collections[count]}`,{dropTarget: true});
                                        return res.status(400).send(err)
                                    }
                                });
                                
                                let restorDB = `mongorestore --uri=${mongoConnectionRestoreUrl}/${reqData.database} --drop --collection=${reqData.collections[count]} ${outPath}/${reqData.database}/${reqData.collections[count]}.bson`
                               
                                await exec(restorDB,async function (err) { 
                                    console.log({err})
                                    if (err) {
                                        await db.renameCollection(`${reqData.collections[count]}${backupSubName}`,`${reqData.collections[count]}`,{dropTarget: true});
                                        return res.status(400).send(err)
                                    } else {
                                        
        
                                        count ++;
                                    }
                                    
                                });
                            });
    
                        } else {
                            issueCollections.push(reqData.collections[count]);
                            count ++;
                           
                        }
                        currentCount ++;
                    }
                    
                    if(count >= collectionLength){
                        clearInterval(backCollections);
                        let removePath = path.join(__dirname, `../../backup/collections`)
                        let removeFolderUrl = `sudo rm -r ${removePath}`
                        let removeCollections = await exec(removeFolderUrl, function (err) { console.log({err})});
                        if(mongoConnection){
                            await mongoConnection.close();
                        }
                        if(issueCollections.length > 0){
                            return res.status(200).send(`${issueCollections.toString()} not Found`)
                        } else {
                            return res.status(200).send(`success`)
                        }
                         
                        
                    }
    
                },5000)
    
                
            } catch(err){
                console.log({err})
               
                return res.status(400).send(err)
            } 
        }
       
    },

    async downlaodSources(req,res,cb) {
        let dest = path.join(__dirname, `../../zip/unZip.zip`);
        let unZipPath = path.join(__dirname, `../../zip/unZipFolder`);
        let url = 'https://codeload.github.com/TotallyInformation/alternate-node-red-installer/zip/master';
        // let url = 'https://git.kloojj.com/AnzuContineo/kloojj-deployment/repository/archive.zip?ref=master'
        var file = fs.createWriteStream(dest);
        var request = https.get(url, function(response) {
          response.pipe(file);
          file.on('finish', async function() {
            
            file.close(cb);  // close() is async, call cb after close completes.

            await extract(dest, { dir: unZipPath })
            var exists = fs.existsSync('c:\\hello.txt');

            return res.status(200).json("success")
          });
        }).on('error', function(err) { // Handle errors
          fs.unlink(dest); // Delete the file async. (But we don't check the result)
          if (cb) cb(err.message);
          return res.status(200).json(err)
        });
    }
}

module.exports = DeploymentController;


