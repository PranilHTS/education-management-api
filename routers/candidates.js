const express = require("express");
const router = express.Router();
const fs = require("fs");
var admin = require("firebase-admin");
serviceAccount = require("../police-exam-management-firebase-adminsdk-mt1cb-4a6f69a10c.json");
if(process.env.NODE_ENV){
   serviceAccount = require("../education-management-c51e3-firebase-adminsdk-exdtw-0e3501e3f0.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
var db = admin.firestore();
const environment = require("../environment");

console.log(process.env.NODE_ENV);

module.exports = (socket) => {
  socket.on("addCandidates", async (data) => {
    const allCandidates = data;
    // console.log(allCandidates);
    let addedCount = 0;
    let failedCount = 0;
    let failedArray = [];
    let duplicateCount = 0;
    let duplicateArray = [];
    for (let i = 0; i < allCandidates.length; i++) {
      const candidate = allCandidates[i];
      const candidateInFirestore = await db
        .collection("students")
        .doc(candidate.Applicant.toString())
        .get();
      if (candidateInFirestore.exists) {
        duplicateCount++;
        duplicateArray.push(candidate);
        socket.emit("message", {
          addedCount,
          failedCount,
          failedArray,
          duplicateCount,
          duplicateArray,
          processFinished: false,
        });
        if (
          addedCount + failedCount + duplicateCount ===
          allCandidates.length
        ) {
          socket.emit("message", {
            addedCount,
            failedCount,
            failedArray,
            duplicateCount,
            duplicateArray,
            processFinished: true,
          });
        }
      } else {
        try {
          db.collection("students")
            .doc(candidate.Applicant.toString())
            .set(candidate)
            .then((resp) => {
              if (resp.writeTime) {
                addedCount++;
                socket.emit("message", {
                  addedCount,
                  failedCount,
                  failedArray,
                  duplicateCount,
                  duplicateArray,
                  processFinished: false,
                });
                if (
                  addedCount + failedCount + duplicateCount ===
                  allCandidates.length
                ) {
                  socket.emit("message", {
                    addedCount,
                    failedCount,
                    failedArray,
                    duplicateCount,
                    duplicateArray,
                    processFinished: true,
                  });
                }
              }
            });
        } catch (err) {
          failedCount++;
          failedArray.push(allCandidates[i]);
          socket.emit("message", {
            addedCount,
            failedCount,
            failedArray,
            duplicateCount,
            duplicateArray,
            processFinished: false,
          });
          if (
            addedCount + failedCount + duplicateCount ===
            allCandidates.length
          ) {
            socket.emit("message", {
              addedCount,
              failedCount,
              failedArray,
              duplicateCount,
              duplicateArray,
              processFinished: true,
            });
          }
        }
      }
    }
  });


  socket.on("replaceCandidates", async (data) => {
    const allCandidates = data;
    // console.log(allCandidates);
    let addedCount = 0;
    let failedCount = 0;
    let failedArray = [];
    for (let i = 0; i < allCandidates.length; i++) {
      const candidate = allCandidates[i];
        try {
          db.collection("students")
            .doc(candidate.Applicant.toString())
            .set(candidate)
            .then((resp) => {
              if (resp.writeTime) {
                addedCount++;
                socket.emit("message", {
                  addedCount,
                  failedCount,
                  failedArray,
                  processFinished: false,
                });
                if (
                  addedCount + failedCount ===
                  allCandidates.length
                ) {
                  socket.emit("message", {
                    addedCount,
                    failedCount,
                    failedArray,
                    processFinished: true,
                  });
                }
              }
            });
        } catch (err) {
          failedCount++;
          failedArray.push(allCandidates[i]);
          socket.emit("message", {
            addedCount,
            failedCount,
            failedArray,
            processFinished: false,
          });
          if (
            addedCount + failedCount ===
            allCandidates.length
          ) {
            socket.emit("message", {
              addedCount,
              failedCount,
              failedArray,
              processFinished: true,
            });
          }
        }

    }
  });
};
