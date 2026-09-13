var os = require("os");

function lanAddresses() {
  var interfaces = os.networkInterfaces();
  var addresses = [];
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (iface) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    });
  });
  return addresses;
}

module.exports = { lanAddresses: lanAddresses };
