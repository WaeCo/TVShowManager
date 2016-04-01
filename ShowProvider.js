const async = require("async");

module.exports = function(config, models) {
    var searchProvider = loadProvider("search");
    var metadataProvider = loadProvider("metadata");
    var statusProvider = loadProvider("status");

    
    this.get = function(id, user, callback) {
        //Parameter parsing
        //user is optional
        if(!callback) {
            callback = user;
            user = null;
        }
        //id may be object: {id: String, type: String}
        var type = null;
        if(id.type) {
            type = id.type;
            id = id.id;
        }
        
        
        var idQuery = {show_id: id};
        if(type == "imdb") 
            idQuery = {imdb_id: id};
            
        models.show.one(idQuery, function(err, show) {
            if(err) return callback(err);
            if(show) {
                async.series([
                    function(cb) {
                        if(user) {
                            models.userShows.one({user_id: user.user_id, show_id: show.show_id}, function(err, userShow) {
                                if(err) return cb(err);
                                for(var key in userShow) {
                                    if(key == "user_id" || key == "show_id") continue;
                                    show[key] = userShow[key];
                                }
                                cb();
                            });
                        } else
                            cb();
                    },
                    function(cb) {
                        show.getEpisodes(function(err, episodes) {
                            cb(err);
                        });
                    }
                ], function(err) {
                    if(err) return callback(err);
                    callback(null, show);
                });
                
                
            } else {
                metadataProvider[0].fetch(id, type, function(err, show) {
                    if(err) return callback(err);
                    if(show) {
                        models.show.create(show, callback);
                    }
                    else
                        callback(new Error("Show not found"));
                });
            }
        });
    };
    
    this.refresh = function(id, type, callback) {
        if(!callback) {
            if(type) {
                callback = type;
                type = null;
            } else //Dummy callback
                callback = function(err) { if(err) console.error("Error:", err.message, "\n", err); };
        }
        
        metadataProvider[0].fetch(id, type, function(err, show) {
            if(err) return callback(err);
            if(!show) return callback(new Error("Show not found"));
            models.show.one({show_id: show.show_id}, function(err, old) {
                if(err) return callback(err);
                if(old) {
                    old.getEpisodes().remove(function(err) {
                        if(err) return callback(err);
                        old.remove(function(err) {
                            if(err) return callback(err);
                            models.show.create(show, callback); 
                        });
                    });
                } else {
                    models.show.create(show, callback);
                }
            });
        });
    };
    
    this.search = function(name, callback) {
        return searchProvider[0].search(name, callback);
    };
    
    this.status = function(episodeId, callback) {
        models.episodeStatus.find({episode_id: episodeId}, function(err, stati) {
            if(err) return callback(err);
            if(stati && stati.length > 0) return callback(null, stati);
            
            refreshStatus(episodeId, callback);
        });
    };
    
    var refreshStatus = this.refreshStatus = function (episodeId, callback) {
        models.episode.get(episodeId, function(err, episode) {
            if(err) return callback(err);
            
            models.show.get(episode.show_id, function(err, show) {
                if(err) return callback(err);
            
                async.map(statusProvider, function(provider, cb) {
                    provider.getUrl(show.name, episode.season, episode.episode, function(err, status) {
                        if(err) return cb(err);
                        //always insert
                        //if(!status) return cb();
                        models.episodeStatus.create({
                            episode_id: episodeId,
                            provider: provider.name,
                            url: status ? status.url : null
                        }, function(err, status) {
                            if(err) return cb(err);
                            cb(null, status);
                        });
                    });
                }, function(err, res) {
                    callback(err, res);
                });
            });
        });
    };
    
    
    function loadProvider(type) {
        var res = [];
        for(var key in config[type]) {
            //disable a Provider by setting it to false
            if(!config[type][key]) continue;
            
            var provider = null;
            try {
                provider = require("./provider/"+key);
            } catch(e) {
                try {
                    provider = require(key);
                } catch(e) {
                    provider = global[key];
                } 
            } 
            if(!provider)
                throw new Error("Could not find "+key+"; it may not be installed");
            res.push(new provider(config[type][key]));
        }
        return res;
    }
};