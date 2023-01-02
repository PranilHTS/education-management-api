const express = require("express");
const router = express.Router();
const fs = require("fs");
var admin = require("firebase-admin");
const environment = require("../environment");
let batchUpdateSize = environment.batchUpdateSize;
var serviceAccount;
if (environment.deploymentType === "production") {
  serviceAccount = require("../education-management-c51e3-firebase-adminsdk-exdtw-0e3501e3f0.json");
} else if (environment.deploymentType === "testing") {
  serviceAccount = require("../exam-test-db-firebase-adminsdk-rfvlj-2779d4390a.json");
} else {
  serviceAccount = require("../exam-admin-testing-firebase-adminsdk-bzhxh-01b2455a27.json");
}
const JSZip = require("jszip");
const { randomUUID } = require("crypto");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
var db = admin.firestore();
var auth = admin.auth()
const pdf2base64 = require('pdf-to-base64');
const { firestore } = require("firebase-admin");

let countMap = {};

function checkIfDataCorrectStudent(studentObj) {
  let reason = '';
  if (!studentObj.examCenterName) {
    valid = false;
    reason = 'Student has no Exam Center Name';
  } else if (!studentObj.Gender) {
    valid = false;
    reason = 'Student has no Gender';
  } else if (!studentObj.Applicant) {
    valid = false;
    reason = 'Student has no Applicant';
  } else if (!studentObj["Full Name"]) {
    valid = false;
    reason = 'Student has no Full Name';
  } else if (!studentObj.examDate) {
    valid = false;
    reason = 'Student has no Exam Date';
  } else if (!studentObj.email) {
    valid = false;
    reason = 'Student has no email';
  }
  return reason;
}

function checkIfDataCorrectExamCenter(examCenter) {
  let reason = '';
  if (!examCenter.examCenterName) {
    valid = false;
    reason = 'examCenter has no Exam Center Name';
  } else if (!examCenter.address) {
    valid = false;
    reason = 'examCenter has no address';
  } else if (!examCenter.City) {
    valid = false;
    reason = 'examCenter has no City';
  } else if (!examCenter["state"]) {
    valid = false;
    reason = 'examCenter has no state';
  } else if (!examCenter.pincode) {
    valid = false;
    reason = 'examCenter has no pincode';
  }
  return reason;
}

async function getHallTicketObjFromStudentObj(studentObj, examObj) {
  let hallTicket;
  let examCenters
  try {
    examCenters = await db
      .collection(environment.examCenterCollection)
      .where("examCenterName", "==", studentObj.examCenterName)
      .get();
  } catch (err) {
    hallTicket = { reason: "Error getting examCenter" }
  }
  examCenters.forEach((examCenter) => {
    let examCenterObj = examCenter.data();
    examCenterObj.id = examCenter.id;
    let reason = checkIfDataCorrectExamCenter(examCenterObj)
    if (reason.length === 0) {
      hallTicket = {
        examCenterId: examCenterObj.id,
        gender: studentObj.Gender,
        examCenter: {
          City: examCenterObj.City,
          name: examCenterObj.examCenterName,
          address: examCenterObj.address,
          state: examCenterObj.state,
          pincode: examCenterObj.pincode,
        },
        hallTicketNumber: studentObj.Applicant,
        examTime: studentObj.examTime,
        examName: examObj.name,
        "Full Name": studentObj["Full Name"],
        examDate: studentObj.examDate,
        studentFullNameForSearch: studentObj.studentFullNameForSearch,
        // studentDetails:studentObj
      };
      if(studentObj.Photo){
        hallTicket.studentPhoto = studentObj.Photo;
      }
      
    } else {
      hallTicket = { reason: reason }
    }
  });
  if (examCenters.empty) {
    hallTicket = { reason: "No Exam Centers Present" }
    return hallTicket;
  } else {
    return hallTicket;
  }
}

async function addUserToSystem(candidate, user) {
  let oldDoc = await db.collection(environment.studentsCollection).doc(user.uid).get()
  if (oldDoc.exists) {
    let oldData = oldDoc.data();
    oldData.id = oldDoc.id;
    if (oldData.fingerprintTemplate1) {
      candidate.fingerprintTemplate1 = oldData.fingerprintTemplate1
    }
    if (oldData.fingerprintTemplate2) {
      candidate.fingerprintTemplate2 = oldData.fingerprintTemplate2
    }
    return { status: "Already exists", candidate };
  } else {
    let studentOuter = {
      "gender": candidate.Gender,
      "name": candidate["Full Name"],
      "email": candidate.email,
      "phone": candidate.phone || "",
      "Pincode": candidate.pincode || "",
      "aadharCard": candidate.aadharCard || "",
      "Full Name": candidate["Full Name"],
      "profilePicture": "",
      "aadharCardFrontPhoto": "",
      "Address": candidate.Address || "",
      "aadharCardBackPhoto": "",
      "City": candidate.City || "",
      "State": candidate.State || "",
      "studentFullNameForSearch": candidate.studentFullNameForSearch
    }
    let studentsResponse = await db.collection(environment.studentsCollection).doc(user.uid).set(studentOuter);
    await db.collection(environment.studentCountCollection).doc("1").update({studentCount: firestore.FieldValue.increment(1)});
    return { response: studentsResponse }
  }
}

async function addStudentsInSubcollections(user, candidate, examObj, resolve, token, length, row) {
  try {
    let candidateId = user.uid;
    let checkIfAlreadyAdded = await db.collection(environment.examCollection).doc(examObj.id).collection(environment.applicantsCollection).doc(candidateId).get()
    if (!checkIfAlreadyAdded.exists) {
      db.collection(environment.examCollection)
        .doc(examObj.id)
        .collection(environment.applicantsCollection)
        .doc(candidateId)
        .set(candidate)
        .then(async (resp) => {
          if (resp.writeTime) {

            let hallTicket = await getHallTicketObjFromStudentObj(
              candidate,
              examObj
            );
            if (hallTicket && hallTicket.reason) {
              db.collection(environment.examCollection).doc(examObj.id).collection(environment.applicantsCollection).doc(candidateId).delete()
              candidate.reason = hallTicket.reason;
              candidate.row = row + 1;
              countMap[token].failedCount++;
              countMap[token].failedArray.push(candidate);
              countMap[token].batchCount++;
              if (countMap[token].batchCount === length) {
                resolve(true);
              }
            } else {
              db.collection(environment.examCollection)
                .doc(examObj.id)
                .collection(environment.hallTicketCollection)
                .doc(candidateId)
                .set({...hallTicket,UID:candidateId})
                .then((hallresp) => {
                  if (hallresp.writeTime) {
                    countMap[token].addedCount++;
                    countMap[token].batchCount++;
                    if (countMap[token].batchCount === length) {
                      resolve(true);
                    }
                  }
                });
            }
          }
        });
    } else {
      countMap[token].duplicateCount++;
      countMap[token].batchCount++;
      countMap[token].duplicateArray.push(candidate);
      if (countMap[token].batchCount === length) {
        resolve(true);
      }
    }
  } catch (err) {
    candidate.reason = err;
    candidate.row = row + 1;
    countMap[token].failedCount++;
    countMap[token].failedArray.push(candidate);
    countMap[token].batchCount++;
    if (countMap[token].batchCount === length) {
      resolve(true);
    }
  }
}


function addFiveHundred(allCandidates, token, start, end, length, examObj) {
  let count = 0;
  return new Promise(async (resolve, reject) => {
    try {
      for (let i = start; i < end; i++) {
        let candidate = allCandidates[i];
        const indexOffset = i;
        let reason = checkIfDataCorrectStudent(candidate);
        if (reason.length === 0) {
          let user = {
            email: candidate.email.trim(),
            emailVerified: false,
            password: candidate["Full Name"].split(' ')[0] + '123456',
            displayName: candidate["Full Name"],
            disabled: false
          };
          if (candidate.UID) {
            user.uid = candidate.UID;
          }
          auth.createUser(user).then((userNew) => {
            user = userNew;
            candidate.UID = user.uid;
          }).catch((err) => {
            if (err.code === 'auth/email-already-exists') {
              user = err.code;
            } else if (candidate.UID) {
              user = {
                uid: candidate.UID
              }
            } else {
              user = {
                uid: randomUUID()
              }
              candidate.UID = user.uid;
            }
          }).finally(async () => {
            if (user === 'auth/email-already-exists') {
              user = await auth.getUserByEmail(candidate.email.trim())
            }
            addUserToSystem(candidate, user).then(async (value) => {
              if (value && value.status === "Already exists") {
                candidate = value.candidate;
              }
              await addStudentsInSubcollections(user, candidate, examObj, resolve, token, length, indexOffset)
            }).catch((err) => {
              candidate.reason = err;
              candidate.row = indexOffset + 1;
              countMap[token].batchCount++;
              countMap[token].failedCount++;
              countMap[token].failedArray.push(candidate);
              if (countMap[token].batchCount === length) {
                resolve(true);
              }
            })
          })
        } else {
          candidate.reason = reason;
          candidate.row = indexOffset + 1;
          countMap[token].batchCount++;
          countMap[token].failedCount++;
          countMap[token].failedArray.push(candidate);
          if (countMap[token].batchCount === length) {
            resolve(true);
          }
        }
      }
    } catch (promiseError) {
      reject(promiseError);
    }
  });
}

router.post("/addCandidates", async (request, response) => {
  const allCandidates = request.body.allCandidates;
  // console.log(allCandidates);
  let token = request.headers.authorization.split(" ")[1];
  let examDoc = await db
    .collection(environment.examCollection)
    .doc(request.body.examId)
    .get();
  console.log(countMap[token].addedCount);
  let examObj = examDoc.data();
  examObj.id = examDoc.id;
  if (token && countMap[token]) {
    let arrayLength = allCandidates.length;
    let batchSize = Math.ceil(arrayLength / batchUpdateSize);
    for (let i = 0; i < batchSize; i++) {
      if (i < batchSize - 1) {
        await addFiveHundred(
          allCandidates,
          token,
          i * batchUpdateSize,
          (i + 1) * batchUpdateSize,
          batchUpdateSize,
          examObj
        ).catch((error) => {
          console.log(error);
        });
        countMap[token].batchCount = 0;
      } else {
        await addFiveHundred(
          allCandidates,
          token,
          i * batchUpdateSize,
          arrayLength,
          arrayLength - i * batchUpdateSize,
          examObj
        ).catch((error) => {
          console.log(error);
        });
        countMap[token].batchCount = 0;
      }
    }
    let initialCount = 0;
    if (examObj.appliedStudentCount && examObj.appliedStudentCount > 0) {
      initialCount = examObj.appliedStudentCount;
    }
    console.log(countMap[token].addedCount)
    
    response.send({
      batchFinished: true,
      duplicateArray: countMap[token].duplicateArray,
      failedArray: countMap[token].failedArray,
      addedCount:countMap[token].addedCount
    });
    if (request.body.isLast) {
      await db.collection(environment.examCollection).doc(request.body.examId).update({ appliedStudentCount: firestore.FieldValue.increment(countMap[token].addedCount)})
      countMap[token].processFinished = true;
    }
    // response.end();
  } else {
    response
      .status(500)
      .send({ message: "Please provide token in authorization" });
    // response.end();
  }
});

router.get("/getAddCandidatesResult", async (request, response) => {
  console.log("getAddCandidatesResult");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders(); // flush the headers to establish SSE with client
  let token = request.query.token;
  if (token && countMap[token]) {
    var refreshIntervalId = setInterval(() => {
      let refreshRate = 5000;
      let id = new Date().getTime();
      let message = {
        addedCount: countMap[token].addedCount,
        failedCount: countMap[token].failedCount,
        processFinished: countMap[token].processFinished,
        duplicateCount: countMap[token].duplicateCount,
        // duplicateArray:countMap[token].duplicateArray
      };
      let data = JSON.stringify(message);
      let messageToSend = `retry: ${refreshRate}\nid:${id}\ndata: ${data}\n\n`;
      response.write(messageToSend);
      if (countMap[token].processFinished) {
        countMap[token].addedCount = 0;
        countMap[token].failedCount = 0;
        countMap[token].processFinished = false;
        response.end();
        clearInterval(refreshIntervalId);
      }
    }, 1000);
  } else {
    response
      .status(500)
      .send({ message: "Please provide token in authorization" });
    response.end();
  }
});

function replaceFiveHundred(allCandidates, token, start, end, length, examObj) {
  let count = 0;
  return new Promise(async (resolve, reject) => {
    try {
      for (let i = start; i < end; i++) {
        const candidate = allCandidates[i];
        try {
          let user = await auth.getUserByEmail(candidate.email.trim())
          db.collection(environment.examCollection).doc(examObj.id).collection(environment.applicantsCollection)
            .doc(user.uid)
            .update(candidate)
            .then(async (resp) => {
              if (resp.writeTime) {
                let hallTicket = await getHallTicketObjFromStudentObj(candidate, examObj)
                if (hallTicket && hallTicket.reason) {
                  countMap[token].failedCountReplace++;
                  candidate.reason = hallTicket.reason;
                  countMap[token].failedArray.push(candidate);
                  if (count === length) {
                    resolve(true);
                  }
                } else {
                  db.collection(environment.examCollection).doc(examObj.id).collection(environment.hallTicketCollection).doc(user.uid).update(hallTicket).then((hallTicketResponse) => {
                    if (hallTicketResponse.writeTime) {
                      countMap[token].addedCountReplace++;
                      count++;
                      if (count === length) {
                        resolve(true);
                      }
                    }
                  })

                }
              }
            });
        } catch (err) {
          candidate.reason = err;
          countMap[token].failedCountReplace++;
          countMap[token].failedArray.push(candidate);
          if (count === length) {
            resolve(true);
          }
        }
      }
    } catch (promiseError) {
      reject(promiseError);
    }
  });
}
router.post("/replaceCandidates", async (request, response) => {
  // console.log(allCandidates);
  let token = request.headers.authorization.split(" ")[1];
  if (token && countMap[token]) {
    let examDoc = await db
      .collection(environment.examCollection)
      .doc(request.body.examId)
      .get();
    let examObj = examDoc.data();
    examObj.id = examDoc.id;
    const allCandidates = request.body.allCandidates;
    let arrayLength = allCandidates.length;
    let batchSize = Math.ceil(arrayLength / batchUpdateSize);
    for (let i = 0; i < batchSize; i++) {
      if (i < batchSize - 1) {
        await replaceFiveHundred(
          allCandidates,
          token,
          i * batchUpdateSize,
          (i + 1) * batchUpdateSize,
          batchUpdateSize,
          examObj
        ).catch((error) => {
          console.log(error);
        });
      } else {
        await replaceFiveHundred(
          allCandidates,
          token,
          i * batchUpdateSize,
          arrayLength,
          arrayLength - i * batchUpdateSize,
          examObj
        ).catch((error) => {
          console.log(error);
        });
      }
    }
    if (request.body.isLast) {
      countMap[token].processFinished = true;
    }
    response.send({ batchFinished: true, failedArray: countMap[token].failedArray });
  } else {
    response
      .status(500)
      .send({ message: "Please provide token in authorization" });
  }
});

router.get("/getReplaceCandidatesResult", async (request, response) => {
  console.log("getReplaceCandidatesResult");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders(); // flush the headers to establish SSE with client
  let token = request.query.token;
  if (token && countMap[token]) {
    var refreshIntervalId = setInterval(() => {
      let refreshRate = 5000;
      let id = new Date().getTime();
      let message = {
        addedCount: countMap[token].addedCountReplace,
        failedCount: countMap[token].failedCountReplace,
        processFinished: countMap[token].processFinished,
      };
      let data = JSON.stringify(message);
      let messageToSend = `retry: ${refreshRate}\nid:${id}\ndata: ${data}\n\n`;
      response.write(messageToSend);
      if (countMap[token].processFinished) {
        response.end();
        clearInterval(refreshIntervalId);
      }
    }, 1000);
  } else {
    response
      .status(500)
      .send({ message: "Please provide token in authorization" });
  }
});

router.get("/getFailedArray", (request, response) => {
  let token = request.headers.authorization.split(" ")[1];
  if (token && countMap[token]) {
    response.send({
      failedArray: countMap[token].failedArray,
    });
    delete countMap[token];
  } else {
    response
      .status(500)
      .send({ message: "Please provide token in authorization" });
  }
});

router.post("/downloadImages", async (req, res) => {
  var zip = new JSZip();
  console.log('Before get');
  let students = await db
    .collection(environment.studentsCollection)
    .where("Status", "==", req.body.status)
    .get();
  console.log('After get');
  let studentsToSend = [];
  console.log('Before for loop');
  students.forEach((student) => {
    let tempStudent = student.data();
    tempStudent.id = student.id;
    // zip.file("img.jpeg", "./test.jpeg");
    var img = zip.folder(tempStudent.Applicant); // ? "student.Applicant" is a folder;
    // ? images to be added:- uploadImage, realTimeImage, id_card_image
    if (tempStudent.uploadImage && tempStudent.uploadImage.length > 0) {
      const uploadImage = tempStudent.uploadImage;
      img.file(
        tempStudent.Applicant + " Uploaded Image.jpeg",
        uploadImage.replace(/^data:image\/(jpeg);base64,/, ""),
        { base64: true }
      );
    }
    if (tempStudent.realTimeImage && tempStudent.realTimeImage.length > 0) {
      const realTimeImage = tempStudent.realTimeImage;
      img.file(
        tempStudent.Applicant + " Captured Image.jpeg",
        realTimeImage.replace(/^data:image\/(jpeg);base64,/, ""),
        { base64: true }
      );
    }
    if (tempStudent.id_card_image && tempStudent.id_card_image.length > 0) {
      const id_card_image = tempStudent.id_card_image;
      img.file(
        tempStudent.Applicant + " ID Card Image.jpeg",
        id_card_image.replace(/^data:image\/(jpeg);base64,/, ""),
        { base64: true }
      );
    }
    studentsToSend.push(tempStudent);
  });
  console.log('Before xip generation');
  zip
    .generateAsync({ type: "base64" })
    .then((content) => {
      // console.log('content: ', content);
      res.send({ blob: content, students: studentsToSend });
    })
    .catch((err) => {
      console.log("err: ", err);
    });
});

router.get("/getToken", (request, response) => {
  var privateKey = environment.privateKey;
  var token = new Date().getTime().toString();
  countMap[token] = {
    addedCount: 0,
    failedCount: 0,
    addedCountReplace: 0,
    failedCountReplace: 0,
    duplicateArray: [],
    duplicateCount: 0,
    processFinished: false,
    failedArray: [],
    alreadyCreatedUsers: [],
    batchCount:0
  };
  setTimeout(() => {
    if (countMap[token]) {
      delete countMap[token];
    }
  }, 1000 * 60 * 60 * 60);
  response.send({
    token,
  });
});

router.post("/downloadResultSheets", async (request, response) => {
  try {
    let content = await downloadResultSheets(request.body.examDocID, request.body.subExamDocID)
    response.send({ content })
  } catch (err) {
    if(err === 'No Result Sheets available'){
      response.send({message:err})
    }else{
      response.status(500).send(err)
    }
  }
})
function downloadResultSheets(examDocID, subExamDocID) {
  return new Promise((resolve, reject) => {
    var zip = new JSZip();
    getAllMeritStudentsByUploadedForm(examDocID, subExamDocID).then((resp) => {
      console.log(resp.size)
      if (resp.docs.length > 0) {
        let count = 0;
        resp.docs.forEach((e) => {
          pdf2base64('https://premium-care-bucket.s3.ap-south-1.amazonaws.com/' + e.data().uploadedForm)
            .then((response) => {
              console.log(response)
              zip.file(e.data().Applicant +'.pdf', response, { base64: true })
              count++;
              if (resp.size === count) {
                zip.generateAsync({ type: "base64" }).then(function (content) {
                  resolve(content)
                });
              }
            })
            .catch((error) => {
              reject(error);
            });
        })
      } else {
        reject("No Result Sheets available")
      }
    })
  })
}

async function getAllMeritStudentsByUploadedForm(examDocID, subExamDocID) {
  return await db.collection(`exams/${examDocID}/subExam/${subExamDocID}/meritStudents`).where('uploadedForm', '!=', '').get()
}
module.exports = router;
