(function(root) {
    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve = {}
    var get = typeof require == 'function' && !(typeof define == 'function' && define.amd) && require('request')

    // ECMA-262 compatible Array#forEach polyfills
    Array.prototype.forEach = Array.prototype.forEach || function(fn, ctx) {
        var len = this.length >>> 0
        for (var i = 0; i < len; ++i){
            if (i in this){
                fn.call(ctx, this[i], i, this)
            }
        }
    }

    //ECMA-262 standard indexOf from Mozilla Developer Network
    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function (searchElement /*, fromIndex */ ) {
            "use strict";
            if (this === null) {
                throw new TypeError();
            }
            var t = Object(this);
            var len = t.length >>> 0;
            if (len === 0) {
                return -1;
            }
            var n = 0;
            if (arguments.length > 0) {
                n = Number(arguments[1]);
                if (isNaN(n)) { // shortcut for verifying if it's NaN
                    n = 0;
                } else if (n !== 0 && n !== Infinity && n !== -Infinity) {
                    n = (n > 0 || -1) * Math.floor(Math.abs(n));
                }
            }
            if (n >= len) {
                return -1;
            }
            var k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);
            for (; k < len; k++) {
                if (k in t && t[k] === searchElement) {
                    return k;
                }
            }
            return -1;
        }
    }

    // Converts an object to an array
    function oc(a){
       var obj = {}
       for(var i=0;i<a.length;i++){
            obj[a[i]]=''
       }
       return obj
    }

    // Fills a template with data from an object
    function format(string, data) {
        "use strict"
        return string.replace(
            /\{\{(?:#(.+?)#)?\s*(.+?)\s*\}\}/g,
            function(m, cond, id) {
                var rv = data[id]
                if (rv === false){
                    return ''
                } else {
                    return rv? (cond || '') + rv : cond? m : ''
                }
            }
       )
    }

    // Pulls data from several streams and handles all with given callback
    function stream(query, callback, custom_services) {
        callback = callback || function(){}
        method = hyve.method

        // use services that contain proper method
        services = []
        check_services = custom_services || Object.keys(hyve.feeds)
        check_services.forEach(function(service){
            if (method in oc(hyve.feeds[service.toLowerCase()].methods)){
               services.push(service.toLowerCase())
           }
        })

        if (services.length === 0) throw "cannot stream; services is empty"

        services.forEach(function(service){
            // set the orig_url to the services feed_url for this method
            if (!hyve.feeds[service].orig_url){
                hyve.feeds[service].orig_url = hyve.feeds[service].feed_urls[method]
            }

            var options = hyve.feeds[service]

            if (options.token_update){
                options.token_update()
                options.token_update_lock = setInterval( options.token_update
                                                       , options.token_timeout
                                                       )
            }


            var runFetch = function(){
                var feed_url

                if (options.format_url){
                    feed_url = format( options.feed_urls[method]
                                    , hyve.feeds[service].format_url(query)
                                    )
                } else {
                    feed_url = format( options.feed_urls[method]
                                    ,{ query:  query
                                    ,  url_suffix: options.url_suffix
                                    ,  result_type: options.result_type
                                    ,  access_token: options.access_token
                                    ,  api_key: options.api_key
                                    ,  auth_user: options.auth_user
                                    ,  auth_signature: options.auth_signature
                                    })
                }

                if (hyve.feeds[service].fetch_url){
                    hyve.feeds[service].fetch_url(service, query, callback)
                } else if (hyve.feeds[service].oauth_version == '1.0'
                            && hyve.method == 'friends') {
                    feed_url = feed_url.substr(0,feed_url.indexOf("?"));
                    hyve.fetch_proxy(feed_url,service)
                } else {
                    fetch(feed_url, service, query, callback)
                }
            }
            runFetch()

            var interval = options.interval
            if (hyve.method == 'friends' && options.interval_friends){
                if (options.interval_friends){
                    interval = options.interval_friends
                }
            }

            hyve.feeds[service].lock = setInterval(function(){
                runFetch()
            }, interval)
        })
    }

    // specific external wrappers for search/stream functionality
    var friends = {
        stream: function(callback, custom_services) {
            hyve.method = 'friends'
            hyve.callback = callback;
            return stream('', callback, custom_services)
        }
    }

    var search = {
        stream: function(query, callback, custom_services) {
            hyve.method = 'search'
            return stream(query, callback, custom_services)
        },
        popular: function(query, callback, custom_services) {
            hyve.method = 'popular'
            return stream(query, callback, custom_services)
        }
    }

    // Stops any running streams for given services
    function stop(custom_services) {
        var services
        services = custom_services || Object.keys(hyve.feeds)
        services.forEach(function(service){
            if (hyve.feeds[service].lock) {
                if (hyve.feeds[service].orig_url){
                    hyve.feeds[service].feed_url = hyve.feeds[service].orig_url
                }
                clearInterval(hyve.feeds[service].lock)
            }
            if (hyve.feeds[service].token_update_lock){
                clearInterval(hyve.feeds[service].token_update_lock)
            }
        })
    }

    // Gives some feeds the chance to claim an item as its own, then returns
    // list of claimed/reformatted items, or the unaltered original
    function claim(item,callback){
        var new_items = []
        var services = Object.keys(hyve.feeds)
        item.links.forEach(function(link){
            if (!hyve.links[link]){
                hyve.links[link] = true
                services.forEach(function(service){
                    if (hyve.feeds[service].claim){
                        var new_item = hyve.feeds[service].claim( link
                                                                , item
                                                                , callback
                                                                )
                        if (new_item){
                            new_items.push(new_item)
                        }
                    }
                })
                if (link.search(/.jpg|.png|.gif/i) != -1){
                    var new_item = item
                    new_item.links = []
                    new_item.type = 'image'
                    if (!new_item.source_img){
                        new_item.source_img = link
                    }
                    if (!new_item.thumbnail){
                        new_item.thumbnail = link
                    }
                    new_items.push(new_item)
                }
            } else {
                new_items.push(item)
            }
        })
        if (new_items.length > 0){
            return new_items
        } else {
            return false
        }
    }

    // Place an item in an appropriate queue depending on its defined 'type'
    function enqueue(item){
        if(item){
            hyve.queue[item.type].sort(function(a,b){
                return b['date'] - a['date']
            })
            if (hyve.recall_enable === true){
                var check_id_key = item.service+':'+item.query+':'+item.id
                if (localStorage.getItem(check_id_key) != 'true'){
                    hyve.queue[item.type].unshift(item)
                    store(item)
                }
            } else {
                hyve.queue[item.type].unshift(item)
            }
        } else {
            throw('enqueue: an undefined item was inputted')
        }
    }

    // Removes an item from hyves queue
    function dequeue(item) {
        if (item) {
            idx = hyve.queue[item.type].indexOf(item)
            // use splice instead of delete as delete
            // leaves undefined element in array
            if (idx != -1) hyve.queue[item.type].splice(idx, 1)
        } else {
            throw('dequeue: an undefined item was inputted')
        }
    }

    // Persistantly stores an item in the browser via localStorage
    function store(item){
        var items_key = item.type+':'+item.query
        var items = localStorage.getItem(items_key)
        if (items){
            items = JSON.parse(items)
        } else {
            items = []
        }
        var check_id_key = item.service+':'+item.query+':'+item.id
        if (localStorage.getItem(check_id_key) != 'true'){
            items.unshift(item)
            localStorage.setItem(check_id_key,true)
        }
        trunc_items = items.splice(0,200)
        try {
            localStorage.setItem(items_key,JSON.stringify(trunc_items))
        } catch(e) {
            console.error('store: localStorage quota exceeded. Emptying', e)
            localStorage.clear()
        }
    }

    // Recall previously saved items from localStorage
    function recall(type,query){
        var itemskey = type+':'+query
        var items = JSON.parse(localStorage.getItem(itemskey)) || []
        items.sort(function(a,b){
            return b['date'] - a['date']
        })
        return items
    }

    // Reset queue and refill it with any previously stored data if any exists
    function replenish(query,types){
        if (hyve.recall_enable === true){
            hyve.queue = { 'text':[]
                         , 'link':[]
                         , 'video':[]
                         , 'image':[]
                         , 'checkin':[]
            }
            types = types || Object.keys(hyve.queue)
            types.forEach(function(type){
                hyve.queue[type] = recall(type,query)
            })
        }
    }


    // similiar to java's hashCode function (32bit)
    function string_hash(s) {
        var hash = 0
        if (s.length === 0) {
            return hash
        }
        for (i = 0 ; i < s.length ; i ++ ) {
            chr  = s.charCodeAt(i)
            hash = ((hash << 5) - hash) + chr
            hash = hash & hash
        }
        return hash
    }

    function processable(item) {
        if (item.text) {
            var hash = string_hash(item.text)

            if (hash) {
                if (hyve.items_seen.indexOf(hash) > -1) {
                    return false
                } else {
                    // if list length limit is reached pop the last item and push to the top
                    if (hyve.items_seen.length > hyve.items_seen_size) {
                        hyve.items_seen.shift()
                    }
                    hyve.items_seen.push(hash)

                    // if hash isn't seen process item
                    return true
                }
            }
        }
        // if no hash do not process
        return false
    }

    // Manually re-classify items as needed, check for dupes, send to callback
    function process(item, callback){
        if (item.date != parseInt(item.date,10)){
            var date_obj = new Date(item.date)
            item.date = date_obj.getTime()/1000
        }

        items = [item];
        item.links = item.links || []
        if (item.links.length > 0) {
            items = claim(item,callback)
        }
        if (items){
            items.forEach(function(item){
                // check if item is processable, i.e not a dupe
                if (processable(item)) {
                    if (hyve.queue_enable){
                        enqueue(item)
                    }
                    try {
                        callback(item)
                    } catch(e) {
                        console.error('process:', e.message, item.service, item.id, item)
                    }
                }
            })
        }
    }

    // Fetches a JSON stream
    var fetch = function() {
        var counter   = 0
        var callbacks = { }
        var head      = !get && document.getElementsByTagName('head')[0]

        // Returns a qualified identifier pointing to a callback
        function get_callback() {
            return format('hyve.callbacks.f{{id}}', { id: ++counter })
        }

        // Cleanup script leftovers from DOM
        function cleanup(script){
            head.removeChild(script)
            for (var property in script){
                delete script[property]
            }
        }

        // Requires a URI using JSONP
        function jsonp(url, callback) {
            var s = document.createElement('script')
            s.type = 'text/javascript'
            s.async = true
            s.src = url
            var wrap_callback = function(){
                cleanup(s)
                return callback.apply(this,arguments)
            }
            hyve.callbacks['f' + counter] = wrap_callback
            var x = document.getElementsByTagName('script')[0]
            x.parentNode.insertBefore(s,x)
        }

        // Requires a URI using the Node.js request library
        function request(url, callback) {
            get(url, function(error, res, data) {
                try {
                    callback(JSON.parse(data))
                } catch(e){
                    console.error('request: fetch failed - ',url, e)
                    callback({ }, e)
                }
            })
        }

        // Abstracts fetching URIs.
        function fetch(url, service, query, callback, item) {
            var fn = pass(service, query, callback, item)
            var cb = !get && get_callback()
            url    = format(url, { callback: cb })
            var fetcher = get? request : jsonp
            script = fetcher(url, fn)
        }

        // Higher-order function to process the fetched data
        function pass(service, query, callback, item) {
            return function(data) {
                // if service supports multiple parsers use that or fallback to
                // parse
                if (hyve.feeds[service].parsers) {
                    if (hyve.method in hyve.feeds[service].parsers) {
                        hyve.feeds[service].parsers[hyve.method](data, query, callback, item)
                    }
                } else {
                    hyve.feeds[service].parse(data, query, callback, item)
                }
            }
        }

        // Export the `fetch` function
        return fetch
    }()

    // A default echo function used when no real request proxy function exists
    function fetch_proxy(feed_url,service){
        console.log('hyve_request_proxy',feed_url,service)
    }

    // Exports data to the outside world
    hyve.friends = friends
    hyve.search = search
    hyve.method = '' // set by the calling stream
    hyve.callback = '' // set by the calling stream
    hyve.stop = stop
    hyve.process = process
    hyve.format = format
    hyve.fetch = fetch
    hyve.fetch_proxy = fetch_proxy // override with your own proxy function
    hyve.recall = recall
    hyve.recall_enable = false
    hyve.replenish = replenish
    hyve.queue = {'text':[],'link':[],'video':[],'image':[],'checkin':[]}
    hyve.queue_enable = false; // enables queuing; no queue by default
    hyve.dequeue = dequeue
    hyve.items_seen = []
    hyve.items_seen_size = 5000 // length of buffer before rolling begins
    hyve.callbacks = []
    hyve.links = {}
    hyve.feeds = {}

    // Export hyve for node/browser compatibilty
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = hyve;
    } else {
        root.hyve = hyve;
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['wordpress'] = {
        methods : ['search'],
        interval : 10000,
        feed_urls : {
            search: 'http://pipes.yahoo.com/pipes/pipe.run?_id=332d9216d8910ba39e6c2577fd321a6a&_render=json&u=http%3A%2F%2Fen.search.wordpress.com%2F%3Fq%3D{{query}}%26s%3Ddate%26f%3Djson{{#&_callback=#callback}}'
        },
        parse : function(data,query,callback){
            if (!this.items_seen){
                this.items_seen = {}
            }
            if (data.value.items.length > 0){
                data.value.items[0].json.forEach(function(item){
                    if (!this.items_seen[item.guid]){
                        this.items_seen[item.guid] = true
                        hyve.process({
                            'service' : 'wordpress',
                            'type' : 'link',
                            'query' : query,
                            'user' : {
                                'id' : item.author,
                                'name' : item.author,
                                'profile' :'',
                                'avatar' : ''
                            },
                            'id' : item.guid,
                            'date' : item.epoch_time,
                            'text' : item.title,
                            'description':item.content,
                            'source' : item.guid,
                            'weight' : 1
                        },callback)
                    }
                }, this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['facebook'] = {
        methods : ['search', 'friends', 'popular'],
        interval : 3000,
        interval_friends : 10000,
        access_token : '',
        feed_urls : {
            search: 'https://graph.facebook.com/search?q={{query}}&limit=25&type=post{{since}}{{#&callback=#callback}}',
            friends: 'https://graph.facebook.com/me/home?limit=25&type=post{{ access_token }}{{ since }}{{#&callback=#callback}}',
            popular: 'https://graph.facebook.com/search?q={{query}}&limit=25&type=post{{since}}{{#&callback=#callback}}'
        },
        format_url : function(query){
            var since_arg = ''
            if (this.since){
                since_arg = '&since='+this.since
            }
            return {
                      query: query
                    , since: since_arg
                    , access_token: '&access_token=' + this.access_token
            }
        },
        parsers : {
            search: function(data, query, callback){
            if (data.data.length > 0){
                var date_obj = new Date(data.data[0].created_time)
                hyve.feeds['facebook'].since = date_obj.getTime()/1000
                data.data.forEach(function(item){
                    if (item.message){
                        var links = []
                        if (item.link){
                            links = [item.link]
                        }
                        var weight = 1
                        if (item.likes) {
                            weight = item.likes.count
                        }
                        hyve.process({
                            'service' : 'facebook',
                            'type' : 'text',
                            'query' : query,
                            'user' : {
                                'id' : item.from.id,
                                'name' : item.from.name,
                                'avatar' : 'http://graph.facebook.com/'+
                                           item.from.id+'/picture',
                                'profile' : "http://facebook.com/"+item.from.id
                            },
                            'id' : item.id,
                            'links': links,
                            'date' : item.created_time,
                            'text' : item.message,
                            'source' : 'http://facebook.com/'+item.from.id,
                            'weight' : weight
                        },callback)
                    }
                },this)
            }
            },
            popular: function(data, query, callback) {

                var sorted_items = []

                data.data && data.data.forEach(function(item) {
                    var weight = 1
                    if (item.likes) {
                        weight = item.likes.count
                    }
                    item.weight = weight
                    sorted_items.push(item)
                })

                // sort by weight
                sorted_items.sort(function(a, b) {
                    return b.weight - a.weight
                })

                sorted_items.forEach(function(item) {
                    if (item.message){
                        var links = []
                        if (item.link){
                            links = [item.link]
                        }
                        hyve.process({
                            'service' : 'facebook',
                            'type' : 'text',
                            'query' : query,
                            'user' : {
                                'id' : item.from.id,
                                'name' : item.from.name,
                                'avatar' : 'http://graph.facebook.com/'+
                                           item.from.id+'/picture',
                                'profile' : "http://facebook.com/"+item.from.id
                            },
                            'id' : item.id,
                            'links': links,
                            'date' : item.created_time,
                            'text' : item.message,
                            'source' : 'http://facebook.com/'+item.from.id,
                            'weight' : item.weight
                           },callback)
                    }
                },this)

                // popular is only called once, stop clears interval
                hyve.stop(['facebook'])
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['digg'] = {
        methods : ['search'],
        interval : 15000,
        min_dates : {},
        feed_urls : {
            search: 'http://services.digg.com/2.0/search.search?query={{query}}&count=20&sort=date-desc&type=javascript{{#&callback=#callback}}'
        },
        format_url : function(query){
            var since_arg
            if (this.min_dates[query]){
                since_arg = '&min_date='+this.min_dates[query]
            }
            return { query: query,
                     since: since_arg }
        },
        parse : function(data,query,callback){
            if (data.stories[0]){
                if (!this.orig_url){
                    this.orig_url = this.feed_url
                }
                if (!this.items_seen){
                    this.items_seen = {}
                }
                var min_date = data.stories[0].submit_date
                if (min_date){
                    this.min_dates[query] = min_date
                }
                data.stories.forEach(function(item){
                    if (!this.items_seen[item.id]){
                        this.items_seen[item.id] = true
                        var weight = 0
                        if (item.diggs){
                            weight = item.diggs
                        }
                        if (item.comments){
                            weight = weight + item.comments
                        }
                        links = []
                        if (item.href.search(/digg.com/i) == -1){
                            links = [item.href]
                        }
                        hyve.process({
                            'service' : 'digg',
                            'type' : 'link',
                            'query' : query,
                            'user' : {
                                'name' : item.user.name,
                                'avatar' : item.user.icon
                            },
                            'id' : item.id,
                            'date' : item.submit_date,
                            'text' : item.title,
                            'links'  : links,
                            'source' : item.shorturl.short_url,
                            'weight' : weight
                        },callback)
                    }
                },this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['foursquare'] = {
        methods : ['search'],
        interval : 15000,
        client_id: '',
        client_secret: '',
        feed_urls :{
            search: 'https://api.foursquare.com/v2/venues/search?query={{query}}{{#&ll=#latlog}}&limit=20{{#&client_id=#client_id}}{{#&client_secret=#client_secret}}{{#&callback=#callback}}'
        },
        fetch_url : function(service,query,callback){
            if (navigator.geolocation){
                var options = this
                navigator.geolocation.getCurrentPosition(function(position){
                    latlog = position.coords.latitude+","+position.coords.longitude
                    var feed_url = hyve.format( options.feed_url,
                                     { query:  query,
                                       latlog: latlog,
                                       client_id: options.client_id,
                                       client_secret: options.client_secret })
                    hyve.fetch(feed_url, service, query, callback)
                },function(){
                    delete services.foursquare
                })
            }
        },
        parse : function(data,query,callback){
            if (!this.items_seen){
                this.items_seen = {}
            }
            if (data.response.groups[0].items){
                data.response.groups[0].items.forEach(function(item){
                    var item_key = item.id+"_"+item.stats.checkinsCount
                    if (!this.items_seen[item_key]){
                        this.items_seen[item_key] = true
                        if (item.contact != undefined){
                            if (item.contact.twitter){
                                user_name = item.contact.twitter
                            } else if (item.contact.formattedPhone){
                                user_name = item.contact.formattedPhone
                            } else if (item.contact.phone){
                                user_name = item.contact.formattedPhone
                            } else {
                                user_name = ''
                            }
                        }
                        var weight = 1
                        if (item.views){
                            weight = item.stats.userCount
                        }
                        date_obj = new Date()
                        date = date_obj.getTime()
                        hyve.process({
                            'service' : 'foursquare',
                            'type' : 'checkin',
                            'date' : date,
                            'geo' : item.location.lat+","+item.location.lng,
                            'query' : query,
                            'user' : {
                                'name' : user_name
                            },
                            'id' : item.id,
                            'text' : item.name,
                            'visits' : item.stats.checkinsCount,
                            'subscribers' : item.stats.usersCount,
                            'weight' : weight
                        },callback)
                    }
                },this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['imgur'] = {
        methods : ['claim'],
        claim : function(link,item){
            if (link.search(/http:\/\/(www|i)?\.?imgur.com\/(?!a)(?!gallery\/)([-|~_0-9A-Za-z]+)\.?&?.*?/ig) != -1){
                item.links = []
                item.origin = item.service
                item.origin_id = item.id
                item.origin_source = item.source
                item.service = 'imgur'
                item.type = 'image'
                item.id = link.replace(/.*imgur.com\/(r\/[A-Za-z]+\/)?([-|~_0-9A-Za-z]+).*/ig, "$2")
                item.source = 'http://imgur.com/'+item.id
                item.source_img = 'http://i.imgur.com/'+item.id+'.jpg'
                item.thumbnail = 'http://i.imgur.com/'+item.id+'l.jpg'
                return item
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['bitly'] = {
        methods : ['unshorten','claim'],
        login:'',
        api_key:'',
        feed_url : 'http://api.bitly.com/v3/expand?shortUrl={{short_url}}{{#&login=#login}}{{#&apiKey=#api_key}}&format=json{{#&callback=#callback}}',
        fetch_url : function(service,link,callback,item){
            var options = hyve.feeds.bitly
            var feed_url = hyve.format( options.feed_url,
                         { short_url: link,
                           login : options.login,
                           api_key: options.api_key})
            hyve.fetch(feed_url, 'bitly', link, callback, item)
        },
        claim : function(link,item,callback){
            if (link.search(/bit.ly|j.mp|bitly.com|tcrn.ch|nyti.ms|pep.si/i) != -1){
                hyve.feeds['bitly'].fetch_url('bitly',link,callback,item)
            }
        },
        parse : function(data,url,callback,item){
            //TODO make this actually handle multiple urls instead of cheating and assuming only one
            var long_urls = []
            if (data.data.expand){
                data.data.expand.forEach(function(link){
                    if (link.long_url){
                        long_urls.push(link.long_url)
                    }
                })
                if (long_urls.length > 0){
                    item.links = long_urls
                }
            }
            hyve.process(item,callback)
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['flickr'] = {
        methods : ['search', 'friends'],
        interval : 10000,
        result_type : 'date-posted-desc',  // date-posted-asc, date-posted-desc, date-taken-asc, date-taken-desc, interestingness-desc, interestingness-asc, relevance
        api_key: '',
        auth_token: '',
        api_sig: '',
        url_suffix_auth : 'rest/?method=flickr.photos.search&',
        url_suffix_anon : 'feeds/photos_public.gne?',
        feed_urls : {
            search: 'http://api.flickr.com/services/{{url_suffix}}&per_page=20&format=json{{#&sort=#result_type}}&tagmode=all&tags={{query}}{{#&jsoncallback=#callback}}&content_type=1&extras=date_upload,date_taken,owner_name,geo,tags,views,url_m,url_b{{#&api_key=#api_key}}',
            friends: 'http://api.flickr.com/services/rest/?method=flickr.photos.getContactsPhotos&api_key={{ api_key }}&extras=date_upload%2Cdate_taken%2Cowner_name%2Cgeo%2Ctags%2Cviews%2Curl_m%2Curl_t&format=json&nojsoncallback=1&auth_token={{ auth_token }}&api_sig={{ api_sig }}{{#&jsoncallback=#callback}}'
        },
        format_url : function(query){
            var url_suffix
            if (this.api_key){
                url_suffix = this.url_suffix_auth
            } else {
                url_suffix = this.url_suffix_anon
            }
            return {   query: query
                     , url_suffix: url_suffix
                     , result_type: this.result_type
                     , api_key: this.api_key
                     , auth_token: this.auth_token
                     , api_sig: this.api_sig
            }
        },
        parsers : {

            search: function(data, query, callback){

                var api_key = hyve.feeds.flickr.api_key

                if (!this.items_seen){
                    this.items_seen = {}
                }
                var items
                if (api_key){
                    items = data.photos.photo
                } else {
                    items = data.items
                }
                items && items.forEach(function(item){
                    var id, thumbnail, source_img, userid, username, source
                    if (api_key){
                        id = item.id
                        if (item.url_m){
                            thumbnail = item.url_m
                            source_img = item.url_m.replace('.jpg','_b.jpg')
                        }
                        username = item.ownername
                        userid = item.owner
                    } else {
                        id = item.media.m
                        thumbnail = item.media.m
                        source_img = item.media.m.replace('_m','_b')
                        source = item.media.m.replace('_m','_b')
                        username = item.author
                        userid = item.author_id
                    }
                    var weight = 0
                    if (item.views){
                        weight = item.views
                    }
                    if (!this.items_seen[id]){
                        this.items_seen[id] = true
                        hyve.process({
                            'service' : 'flickr',
                            'type' : 'image',
                            'query' : query,
                            'user' : {
                                'id' : userid,
                                'name' : username,
                                'avatar' : ''
                            },
                            'id' : id,
                            'date' : item.dateupload,
                            'text' : item.title,
                            'source' : item.link,
                            'source_img' : source_img,
                            'thumbnail': thumbnail,
                            'weight' : weight
                        },callback)
                    }
                }, this)
            },

            friends: function(data, query, callback) {
                 if (!this.items_seen){
                    this.items_seen = {}
                }
                var items = data.photos.photo
                items.forEach(function(item) {
                    if (!this.items_seen[item.id]) {
                        this.items_seen[item.id] = true

                        source_url = 'http://flickr.com/photos/'+item.owner+'/'+ item.id
                        source_img = 'http://farm'+ item.farm + '.staticflickr.com/' + item.server + '/' + item.id + '_' + item.secret + '.jpg'

                        hyve.process({
                            'service' : 'flickr',
                            'type' : 'image',
                            'query' : query,
                            'user' : {
                                'id' : item.owner,
                                'name' : item.username,
                                'avatar' : ''
                            },
                            'id' : item.id,
                            'date' : item.dateupload,
                            'text' : item.title,
                            'source' : source_url,
                            'source_img' : source_img,
                            'thumbnail': item.url_t,
                            'weight' : item.views
                        }, callback)
                    }
                }, this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds.twitter = {
        methods : ['search', 'friends', 'popular'],
        interval : 2000,
        interval_friends : 10000,
        result_type : 'mixed', // mixed, recent, popular
        since_ids : {},
        oauth_consumer_key : '',
        oauth_nonce  : '',
        oauth_signature : '',
        oauth_signature_method : 'HMAC-SHA1',
        oauth_timestamp : '',
        oauth_token : '',
        oauth_version : '1.0',
        feed_urls : {
            search: 'http://search.twitter.com/search.json?q={{query}}&lang=en&include_entities=True{{#&result_type=#result_type}}{{since}}{{#&callback=#callback}}',
            friends: 'https://api.twitter.com/1/statuses/home_timeline.json?{{ key }}{{ nonce }}{{ signature }}{{ signature_method }}{{ timestamp }}{{ token }}{{ version }}{{#&callback=#callback}}{{ since }}',
            popular: 'http://search.twitter.com/search.json?q={{query}}&lang=en&rpp=25&include_entities=True{{#&result_type=#result_type}}{{since}}{{#&callback=#callback}}'
        },
        format_url : function(query){
            var since_arg
            if (this.since_ids[query]){
                since_arg = '&since_id='+this.since_ids[query]
            }
            return {
                      query: query
                    , result_type: this.result_type
                    , since: since_arg
                    , key: 'oauth_consumer_key='  + this.oauth_consumer_key
                    , nonce: '&oauth_nonce=' + this.oauth_nonce
                    , signature: '&oauth_signature=' + this.oauth_signature
                    , signature_method: '&oauth_signature_method=' + this.oauth_signature_method
                    , timestamp: '&oauth_timestamp=' + this.oauth_timestamp
                    , token: '&oauth_token=' + this.oauth_token
                    , version: '&oauth_version=' + this.oauth_version
            }
        },
        parsers : {
            search : function(data, query, callback){
                if (data.refresh_url){
                    hyve.feeds.twitter.since_ids[query] = data.refresh_url.replace(/\?since_id=([0-9]+).*/ig, "$1")
                }
                if (!this.items_seen){
                    this.items_seen = {}
                }
                if (data.results){
                    data.results.forEach(function(item){
                        if (!this.items_seen[item.id_str.toString()]){
                            this.items_seen[item.id_str.toString()] = true
                            var links = []
                            if (item.entities.urls) {
                                item.entities.urls.forEach(function(url){
                                    if(url.expanded_url){
                                        links.push(url.expanded_url)
                                    } else {
                                        links.push("http://"+url.url)
                                    }
                                })
                            }
                            var weight = 1
                            if (item.metadata.result_type == 'popular'){
                                weight = item.metadata.recent_retweets
                            }

                            hyve.process({
                                'service' : 'twitter',
                                'type' : 'text',
                                'query' : query,
                                'user' : {
                                    'id' : item.from_user_id_str,
                                    'avatar' : item.profile_image_url,
                                    'profile' : "http://twitter.com/"+item.from_user
                                },
                                'id' : item.id_str,
                                'date' : item.created_at,
                                'text' : item.text,
                                'links' : links,
                                'source' : 'http://twitter.com/'+
                                           item.from_user+
                                           '/status/'+item.id,
                                'weight' : weight
                            },callback)
                        }
                    },this)
                }
            },

            friends : function(data, query, callback) {
                if (data) {
                    if (!this.items_seen) this.items_seen = {}

                    data.forEach(function(item)  {

                        id = item.id_str

                        var weight = 1
                        if (item.retweet_count) {
                            weight = item.retweet_count
                        }

                        if (!this.items_seen[id]) {
                           this.items_seen[id] = true

                            hyve.process({
                                'service': 'twitter',
                                'type': 'text',
                                'query': query,
                                'user' : {
                                    'id': item.user.id_str,
                                    'name': item.user.name,
                                    'avatar': item.profile_image_url,
                                    'profile':  "http://twitter.com/" + item.user.screen_name
                                },
                                'id': id,
                                'date': item.created_at,
                                'text': item.text,
                                'source': "http://twitter.com/" + item.user.screen_name + "/status/" + id,
                                'weight': weight
                            }, callback)
                        }
                    }, this);
                }
            },

            popular: function(data, query, callback) {

                var sorted_items = []

                if (data.results) {
                    data.results.forEach(function(item) {
                        var weight = 1
                        var recent_retweets = item.metadata.recent_retweets
                        if (recent_retweets > 1) {
                            weight = recent_retweets
                        }
                        item.weight = weight
                        sorted_items.push(item)

                        item.links = []
                        if (item.entities.urls) {
                            item.entities.urls.forEach(function(url){
                                if(url.expanded_url){
                                    item.links.push(url.expanded_url)
                                } else {
                                    item.links.push("http://"+url.url)
                                }
                            })
                        }

                    })

                    sorted_items.sort(function(a, b) {
                        return b.weight - a.weight
                    })

                    sorted_items.forEach(function(item) {
                        hyve.process({
                            'service' : 'twitter',
                            'type' : 'text',
                            'query' : query,
                            'user' : {
                                'id' : item.from_user_id_str,
                                'avatar' : item.profile_image_url,
                                'profile' : "http://twitter.com/"+item.from_user
                            },
                            'id' : item.id_str,
                            'date' : item.created_at,
                            'text' : item.text,
                            'links' : item.links,
                            'source' : 'http://twitter.com/'+
                                       item.from_user+
                                       '/status/'+item.id,
                            'weight' : item.weight
                        }, callback)
                    }, this)

                    //popular is called once, clear interval
                    hyve.stop(['twitter'])
                }
            }
        }
    }
})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['reddit'] = {
        methods : ['search', 'popular'],
        interval : 5000,
        feed_urls : { // sort types: relevance, top, new
            search: 'http://www.reddit.com/search.json?q={{query}}&sort=relevance{{#&jsonp=#callback}}{{before}}',
            popular: 'http://www.reddit.com/search.json?q={{query}}&sort=top{{#&jsonp=#callback}}{{before}}'
        },
        format_url : function(query){
            var before_arg = ''
            if (this.before){
                before_arg = '&before='+this.before
            }
            return { query: query,
                     before: before_arg
                   }
        },
        parse : function(data,query,callback){
            if (data.data.children[0]){
                this.before = data.data.children[0].data.name
                data.data.children.forEach(function(item){
                    var weight = 1
                    if (item.data.score){
                        weight = item.data.score
                    }
                    if (item.data.ups){
                        weight = weight + item.data.ups
                    }
                    if (item.data.num_comments){
                        weight = weight + item.data.num_comments
                    }
                    if (item.data.likes){
                        weight = weight + item.data.likes
                    }
                    links = []
                    if (item.data.url.search(/reddit.com/i) == -1){
                        links = [item.data.url]
                    }
                    hyve.process({
                        'service' : 'reddit',
                        'type' : 'link',
                        'query' : query,
                        'user' : {
                            'name' : item.data.author,
                            'avatar' : ''
                        },
                        'id' : item.data.id,
                        'date' : item.data.created_utc,
                        'text' : item.data.title,
                        'links'  : links,
                        'source' : item.data.url,
                        'thumbnail': item.data.thumbnail,
                        'weight' : weight
                    },callback)
                })
                if (hyve.method == 'popular') {
                    hyve.stop(['reddit'])
                }
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['delicious'] = {
        methods : ['search'],
        interval : 15000,
        feed_urls : {
            search: 'http://feeds.delicious.com/v2/json/tag/{{query}}?count=20{{#&callback=#callback}}'
        },
        parse : function(data,query,callback){
            if (!this.items_seen){
                this.items_seen = {}
            }
            if (data[0]){
                data.forEach(function(item){
                    if (!this.items_seen[item.u]){
                        this.items_seen[item.u] = true
                        hyve.process({
                            'service' : 'delicious',
                            'type' : 'link',
                            'query' : query,
                            'user' : {
                                'name' : item.a
                            },
                            'id' : item.u,
                            'date' : item.dt,
                            'text' : item.d,
                            'links'  : [item.u],
                            'source' : item.u,
                            'weight' : 1
                        },callback)
                    }
                },this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['plus'] = {
        interval : 5000,
        methods : ['search', 'popular'],
        api_key : '',
        feed_urls : {
            search: 'https://www.googleapis.com/plus/v1/activities?query={{query}}&language=en&orderBy=recent&maxResults=20&pp=1&key={{api_key}}{{#&callback=#callback}}',
            popular: 'https://www.googleapis.com/plus/v1/activities?query={{query}}&language=en&orderBy=best&maxResults=20&pp=1&key={{api_key}}{{#&callback=#callback}}'
        },
        parsers: {

            search: function(data, query, callback) {
            if (!this.items_seen){
                this.items_seen = {}
            }
            if (!hyve.feeds.plus.api_key) throw "The google plus plugin has no api-key defined."

            if (data.items){
                data.items.forEach(function(item){
                    if (!this.items_seen[item.id]){
                        this.items_seen[item.id] = true

                        var weight = 1
                        if (item.object.plusoners.totalItems > 1) {
                            weight = item.object.plusoners.totalItems
                        }

                        item.type = 'text'

                        if (!item.title){
                            item.type = 'link'
                            item.url = item.object.attachments[0].url
                            item.title = item.object.attachments[0].displayName
                        }
                        hyve.process({
                            'service' : 'plus',
                            'type' : item.type,
                            'user' : {
                                'id': item.actor.id,
                                'name' : item.actor.displayName,
                                'avatar' : item.actor.image.url,
                                'profile':  item.actor.url
                            },
                            'query' : query,
                            'id' : item.id,
                            'date' : item.published,
                            'text' : item.title,
                            'source' : item.url,
                            'weight': weight
                        },callback)
                    }
                }, this)
            }
        },

        popular : function(data, query, callback) {

            sorted_items = []

            if (data.items) {
                data.items.forEach(function(item) {

                    item.weight = 1
                    if (item.object.plusoners.totalItems > 1) {
                        item.weight = item.object.plusoners.totalItems
                    }
                    item.type = 'text'
                    if (!item.title){
                        item.type = 'link'
                        item.url = item.object.attachments[0].url
                        item.title = item.object.attachments[0].displayName
                    }
                    sorted_items.push(item)
                }, this)

            }

            if(sorted_items) {
                sorted_items.sort(function(a, b) {
                    return b.weight - a.weight
                })

                sorted_items.forEach(function(item) {
                    hyve.process({
                        'service' : 'plus',
                        'type' : item.type,
                        'user' : {
                            'id': item.actor.id,
                            'name' : item.actor.displayName,
                            'avatar' : item.actor.image.url,
                            'profile':  item.actor.url
                        },
                        'query' : query,
                        'id' : item.id,
                        'date' : item.published,
                        'text' : item.title,
                        'source' : item.url,
                        'weight': item.weight
                    }, callback)

                }, this)
                hyve.stop(['plus'])
            }
        }
    }
}

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['vimeo'] = {
        methods : ['claim'],
        claim : function(link,item,callback){
            if (link.search(/vimeo.com/i) != -1){
                item.links = []
                item.origin = item.service
                item.origin_id = item.id
                item.origin_source = item.source
                item.service = 'vimeo'
                item.type = 'video'
                item.id = item.source.replace(/.*com\/(.*)/ig,"$1")
                return item
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['identica'] = {
        methods : ['search'],
        interval : 6000,
        since_ids : {},
        feed_urls :{
            search: 'http://identi.ca/api/search.json?lang=en&q={{query}}{{since}}{{#&callback=#callback}}'
        },
        format_url : function(query){
            var since_arg
            if (this.since_ids[query]){
                since_arg = '&since_id='+this.since_ids[query]
            }
            return { query: query,
                     result_type: this.result_type,
                     since: since_arg }
        },
        parse : function(data,query,callback){
            if (data.refresh_url){
                this.since_ids[query] = data.refresh_url.replace(/\?since_id=([0-9]+).*/ig, "$1")
            }
            data.results.forEach(function(item){
                hyve.process({
                    'service' : 'identica',
                    'type' : 'text',
                    'query' : query,
                    'user' : {
                        'id' : item.from_user_id_str,
                        'name' : item.from_user,
                        'avatar' : item.profile_image_url,
                        'profile' : "http://identi.ca/"+item.from_user
                    },
                    'id' : item.id,
                    'date' : item.created_at,
                    'text' : item.text,
                    'source' : 'http://identica.com/bookmark/'+item.id,
                    'weight' : 1
                },callback)
            })
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['picasa'] = {
        methods : ['search'],
        interval : 15000,
        feed_urls : {
            search: 'https://picasaweb.google.com/data/feed/api/all?q={{query}}&max-results=20&kind=photo&alt=json{{#&callback=#callback}}'
        },
        parse : function(data,query,callback){
            var newest_date
            var newest_epoch
            if (!this.orig_url){
                this.orig_url = this.feed_url
            }
            if (this.newest_date){
                this.feed_url = this.orig_url + '&published-min=' + this.newest_date
            }
            if (!this.items_seen){
                this.items_seen = {}
            }
            if (data.feed.entry){
                data.feed.entry.forEach(function(item){
                    if (!this.items_seen[item.id.$t]){
                        var datetime = item.published.$t.split('.')[0]
                        var epoch = Date.parse(datetime)
                        if (!this.newest_epoch){
                            this.newest_epoch = epoch
                            this.newest_date = datetime
                        } else if (this.epoch > this.newest_epoch){
                            newest_epoch = epoch
                            this.newest_date = datetime
                        }
                        this.items_seen[item.id.$t] = true
                        var weight = 0
                        if (item.summary.$t){
                            text = item.summary.$t
                            weight = 1
                        } else {
                            text = item.title.$t
                        }
                        if (item.gphoto$commentCount){
                            weight = weight + item.gphoto$commentCount
                        }
                        hyve.process({
                            'service' : 'picasa',
                            'type' : 'image',
                            'query' : query,
                            'user' : {
                                'id' : item.author[0].gphoto$user.$t,
                                'name' : item.author[0].name.$t,
                                'avatar' : item.author[0].gphoto$thumbnail.$t
                            },
                            'id' : item.id.$t,
                            'date' : item.published.$t,
                            'text' : item.title.$t,
                            'source' : item.content.src,
                            'source_img' : item.content.src,
                            'thumbnail':item.media$group.media$thumbnail[1].url,
                            'weight': weight
                        },callback)
                    }
                }, this)
            }
        }
    }

})(this)
;(function(root) {

    var hyve = (typeof require == 'function' && !(typeof define == 'function' && define.amd)) ? require('../src/hyve.core.js') : root.hyve

    hyve.feeds['youtube'] = {
        methods : ['search','claim', 'friends', 'popular'],
        interval : 8000,
        result_type : 'videos',  //  videos,top_rated, most_popular, standard_feeds/most_recent, most_dicsussed, most_responded, recently_featured, on_the_web
        feed_suffix : '', // '', standardfeeds/ - if '' result_type must be 'videos'
        access_token : '',
        token_timeout: 60000,
        feed_urls : {
            search: 'http://gdata.youtube.com/feeds/api/{{feed_suffix}}{{result_type}}?q={{query}}&time=today&orderby=published&format=5&max-results=20&v=2&alt=jsonc{{#&callback=#callback}}',
            friends: 'https://gdata.youtube.com/feeds/api/users/default/newsubscriptionvideos?v=2&alt=jsonc&access_token={{ access_token }}{{#&callback=#callback}}',
            popular: 'http://gdata.youtube.com/feeds/api/{{feed_suffix}}{{result_type}}?q={{query}}&time=today&orderby=viewCount&format=5&max-results=20&v=2&alt=jsonc{{#&callback=#callback}}'
        },
        token_update : function(){
            console.log('The Google API token has expired. \nOverride hyve.feeds.youtube.token_update with your own handler to obtain a new token');
        },
        claim : function(link,item){
            if (link.search(/youtu.be|youtube.com.*v=/i) != -1){
                item.links = []
                item.origin = item.service
                item.origin_id = item.id
                item.origin_source = item.source
                item.service = 'youtube'
                item.type = 'video'
                if (link.search(/youtu.be/i) != -1){
                    item.id = link.replace(/.*be\/([a-zA-Z0-9_-]+).*/ig,"$1")
                }
                if (link.search(/youtube.com/i) != -1){
                    item.id = link.split("v=")[1].substring(0,11)
                }
                item.source = 'http://youtu.be/'+item.id
                item.thumbnail = 'http://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg'
                return item
            }
        },
        parsers : {
            search: function(data,query,callback){
                if (!this.items_seen){
                    this.items_seen = {}
                }

                items = data.data.items

                if (items) {
                    items.forEach(function(item){
                        var weight = 1
                        if (item.views) {
                            weight = item.stats.userCount
                        }

                        if (!this.items_seen[item.id]) {
                            this.items_seen[item.id] = true

                            hyve.process({
                                'service' : 'youtube',
                                'type' : 'video',
                                'query' : query,
                                'user' : {
                                    'id' : item.uploader,
                                    'name' : item.uploader,
                                    'profile' : 'http://youtube.com/' + item.uploader,
                                    'avatar' : ''
                                },
                                'id' : item.id,
                                'date' : item.uploaded,
                                'text' : item.title,
                                'source' : 'http://youtu.be/'+ item.id,
                                'thumbnail':'http://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg',
                                'weight' : weight
                            }, callback)
                        }
                    }, this)
                }
            },
            friends : function(data, query, callback) { //the friends method is mostly identical to search
                return this.search(data, query, callback)
            },
            popular: function(data, query, callback) {
                var sorted_items = []

                items = data.data.items

                if (items) {
                    items.forEach(function(item) {
                        item.weight = 1
                        if (item.likeCount > 1)
                            item.weight = item.likeCount
                        sorted_items.push(item)
                    }, this)
                }

                if(sorted_items) {

                    sorted_items.sort(function(a, b) {
                        return b.weight - a.weight
                    })

                    sorted_items.forEach(function(item) {
                         hyve.process({
                            'service' : 'youtube',
                            'type' : 'video',
                            'query' : query,
                            'user' : {
                                'id' : item.uploader,
                                'name' : item.uploader,
                                'profile' : 'http://youtube.com/' + item.uploader,
                                'avatar' : ''
                            },
                            'id' : item.id,
                            'date' : item.uploaded,
                            'text' : item.title,
                            'source' : 'http://youtu.be/'+ item.id,
                            'thumbnail':'http://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg',
                            'weight' : item.weight
                        }, callback)

                    }, this)
                }
                hyve.stop(['youtube'])

            }
        }
    }
})(this)
