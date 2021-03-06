const config = require("./config");

const express = require("express");
const path = require("path");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const request = require("request");
const csvParser = require("json-2-csv");

const oauth2 = require("simple-oauth2").create({
  client: {
    id: config.client_id,
    secret: config.client_secret
  },
  auth: {
    tokenHost: "https://todoist.com",
    tokenPath: "/oauth/access_token",
    authorizePath: "/oauth/authorize"
  },
  options: {
    authorizationMethod: "body"
  }
});

process.env["NODE_ENV"] = "production";

const app = express();
const subdirectory = "/todoist-export";

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.set("json spaces", 2); // prettify json output

app.use(logger("dev"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(subdirectory, express.static(path.join(__dirname, "..", "public")));

app.get(subdirectory + "/", (req, res) => {
  res.render("index", {});
});

function call(api, parameters, callback) {
  request.post(
    {
      url: "https://todoist.com/API/v7/" + api,
      form: parameters,
      json: true
    },
    callback
  );
}

function sendError(res, message) {
  res.render("error", {
    message: message
  });
}

app.post(subdirectory + "/auth", (req, res) => {
  const format = req.body.format; // csv vs. json

  res.redirect(
    oauth2.authorizationCode.authorizeURL({
      scope: "data:read",
      state: format
    })
  );
});

app.get(subdirectory + "/export", (req, res) => {
  const code = req.query.code;

  oauth2.authorizationCode
    .getToken({
      code: code
    })
    .then(result => {
      const token = result["access_token"];
      const format = req.query.format;

      res.redirect(subdirectory + "?token=" + token + "&format=" + format);
    })
    .catch(err => sendError(res, err));
});

app.get(subdirectory + "/download", (req, res) => {
  exportData(res, req.query.token, req.query.format);
});

function exportData(res, token, format) {
  call(
    "sync",
    {
      token: token,
      sync_token: "*",
      resource_types: '["all"]'
    },
    (err, http, syncData) => {
      if (err) return sendError(res, err);

      call(
        "completed/get_all",
        { token: token },
        (err, http, completedData) => {
          if (err) return sendError(res, err);

          syncData.completed = completedData; // add completed tasks

          if (format === "json") {
            res.attachment("todoist.json");
            res.json(syncData);
          } else if (format === "csv") {
            try {
              csvParser.json2csv(replaceCommas(syncData.items), (err, csv) => {
                if (err) {
                  return sendError(res, "CSV export error.");
                }
                res.attachment("todoist.csv");
                res.send(csv);
              });
            } catch (err) {
              return sendError(res, "CSV export error.");
            }
          } else {
            return sendError(res, "Unknown format: " + format);
          }
        }
      );
    }
  );
}

function replaceCommas(items) {
  // TODO: convert label ids to names
  for (const key in items) {
    if (items.hasOwnProperty(key)) {
      const item = items[key];
      // surround columns containing comma values with quotes
      item["labels"] = '"' + item["labels"].toString() + '"';
      item["content"] = '"' + item["content"].toString() + '"';
    }
  }
  return items;
}

app.get("*", function(req, res) {
  res.redirect(subdirectory);
});

if (app.get("env") === "development") {
  app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.render("error", {
      message: err.message,
      error: err
    });
  });
}

app.use(function(err, req, res) {
  res.status(err.status || 500);
  res.render("error", {
    message: err.message
  });
});

module.exports = app;
