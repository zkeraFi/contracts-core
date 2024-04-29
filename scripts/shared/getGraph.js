const hre = require("hardhat");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function getGraph(query) {
  const res = await fetch("https://api.studio.thegraph.com/query/52242/zlp-pool/version/latest", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      query: query,
    }),
  }).then(data=>data.json());

  return res.data;
}

module.exports = {
    getGraph
  }