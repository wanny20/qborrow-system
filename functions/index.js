const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({ maxInstances: 10 });

const db = admin.firestore();

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = defineSecret("BREVO_SENDER_EMAIL");
const BREVO_SENDER_NAME = defineSecret("BREVO_SENDER_NAME");

const DEFAULT_CATEGORIES = [
  { id: "sports", name: "Sports Items" },
  { id: "laboratory", name: "Laboratory Items" },
  { id: "stem", name: "STEM Items" },
  { id: "it", name: "IT Items" },
];

const VALID_USER_TYPES = ["Student", "Faculty", "Staff"];

function cleanText(value) {
  return String(value || "").trim();
}

function cleanUserType(value) {
  const cleanedValue = cleanText(value);

  if (VALID_USER_TYPES.includes(cleanedValue)) {
    return cleanedValue;
  }

  return "Student";
}

function normalizeCategoryId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getBorrowerDetailsPayload(borrower) {
  const userType = cleanUserType(borrower.userType || borrower.borrowerType);

  const studentNumber = cleanText(
    borrower.studentNumber || borrower.studentId
  );

  const employeeId = cleanText(
    borrower.employeeId || borrower.employeeNumber
  );

  const courseDepartment = cleanText(
    borrower.courseDepartment ||
      borrower.course ||
      borrower.department ||
      borrower.courseOrDepartment
  );

  const yearLevel = cleanText(borrower.yearLevel || borrower.year);
  const section = cleanText(borrower.section);

  const mobileNumber = cleanText(
    borrower.mobileNumber ||
      borrower.mobile ||
      borrower.phone ||
      borrower.phoneNumber ||
      borrower.contactNumber
  );

  return {
    userType,
    studentNumber: userType === "Student" ? studentNumber : "",
    employeeId:
      userType === "Faculty" || userType === "Staff" ? employeeId : "",
    courseDepartment,
    yearLevel: userType === "Student" ? yearLevel : "",
    section: userType === "Student" ? section : "",
    mobileNumber,
  };
}
function normalizeUniqueKey(value) {
  return cleanText(value).toLowerCase();
}

async function authEmailExists(email) {
  try {
    await admin.auth().getUserByEmail(email);
    return true;
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      return false;
    }

    throw error;
  }
}

async function userFieldExists(fieldName, value) {
  if (!value) return false;

  const snapshot = await db
    .collection("users")
    .where(fieldName, "==", value)
    .limit(1)
    .get();

  return !snapshot.empty;
}

function getAuthCreateErrorMessage(error) {
  if (
    error.code === "auth/email-already-exists" ||
    error.code === "auth/email-already-in-use"
  ) {
    return "This email is already registered.";
  }

  if (error.code === "auth/invalid-email") {
    return "Invalid email address.";
  }

  if (error.code === "auth/weak-password") {
    return "Password is too weak.";
  }

  return error.message || "Unable to create borrower.";
} 

async function requireSuperAdmin(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const currentUserRef = db.collection("users").doc(request.auth.uid);
  const currentUserSnap = await currentUserRef.get();

  if (!currentUserSnap.exists) {
    throw new HttpsError("permission-denied", "User record not found.");
  }

  const currentUserData = currentUserSnap.data();

  if (currentUserData.role !== "superAdmin") {
    throw new HttpsError(
      "permission-denied",
      "Only super admins can perform this action."
    );
  }

  return {
    uid: request.auth.uid,
    ...currentUserData,
  };
}

async function collectionHasMatch(collectionName, fieldName, value) {
  const snapshot = await db
    .collection(collectionName)
    .where(fieldName, "==", value)
    .limit(1)
    .get();

  return !snapshot.empty;
}

async function collectionHasArrayMatch(collectionName, fieldName, value) {
  const snapshot = await db
    .collection(collectionName)
    .where(fieldName, "array-contains", value)
    .limit(1)
    .get();

  return !snapshot.empty;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBorrowRequestEmailContent(request, previousStatus, nextStatus) {
  const borrowerName = escapeHtml(
    request.borrowerName || request.borrowerEmail || "Borrower"
  );

  const itemName = escapeHtml(request.itemName || "Requested item");
  const itemCode = escapeHtml(request.itemCode || request.itemId || "N/A");
  const borrowDate = escapeHtml(request.borrowDate || "Not set");
  const expectedReturnDate = escapeHtml(
    request.expectedReturnDate || "Not set"
  );

  // FIX: Removed erroneous ``` markers that ChatGPT inserted inside this object
  const statusMessages = {
    Approved: {
      subject: `QBorrow: Borrow request approved for ${itemName}`,
      title: "Borrow Request Approved",
      message:
        "Your borrow request has been approved. Please wait for the admin to release the item.",
    },
    Rejected: {
      subject: `QBorrow: Borrow request rejected for ${itemName}`,
      title: "Borrow Request Rejected",
      message:
        "Your borrow request was rejected. Please check your QBorrow account for updates.",
    },
    Borrowed: {
      subject: `QBorrow: Item released - ${itemName}`,
      title: "Item Released",
      message:
        "The item has been physically released to you. Please return it on or before the expected return date.",
    },
    Returned: {
      subject: `QBorrow: Item returned - ${itemName}`,
      title: "Item Returned",
      message:
        "Your borrowed item has been marked as returned. Thank you for using QBorrow.",
    },
    Cancelled: {
      subject: `QBorrow: Borrow request cancelled for ${itemName}`,
      title: "Borrow Request Cancelled",
      message: "Your borrow request has been cancelled.",
    },
  };

  const content = statusMessages[nextStatus];

  if (!content) {
    return null;
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px;">
      <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 2px solid #1e293b; border-radius: 18px; overflow: hidden;">
        <div style="background: #8b5cf6; color: #ffffff; padding: 20px;">
          <h1 style="margin: 0; font-size: 24px;">QBorrow</h1>
          <p style="margin: 6px 0 0;">QR-Based Digital Borrowing System</p>
        </div>

        <div style="padding: 22px; color: #1e293b;">
          <h2 style="margin-top: 0;">${content.title}</h2>

          <p>Hello ${borrowerName},</p>

          <p>${content.message}</p>

          <div style="background: #fffdf5; border: 2px solid #1e293b; border-radius: 14px; padding: 16px; margin: 18px 0;">
            <p><strong>Item:</strong> ${itemName}</p>
            <p><strong>Item Code:</strong> ${itemCode}</p>
            <p><strong>Previous Status:</strong> ${escapeHtml(previousStatus || "N/A")}</p>
            <p><strong>Current Status:</strong> ${escapeHtml(nextStatus)}</p>
            <p><strong>Borrow Date:</strong> ${borrowDate}</p>
            <p><strong>Expected Return:</strong> ${expectedReturnDate}</p>
          </div>

          <p style="font-size: 13px; color: #64748b;">
            This is an automated email from QBorrow. Please do not reply to this message.
          </p>
        </div>
      </div>
    </div>
  `;

  const textContent = `
QBorrow - ${content.title}

Hello ${request.borrowerName || request.borrowerEmail || "Borrower"},

${content.message}

Item: ${request.itemName || "Requested item"}
Item Code: ${request.itemCode || request.itemId || "N/A"}
Previous Status: ${previousStatus || "N/A"}
Current Status: ${nextStatus}
Borrow Date: ${request.borrowDate || "Not set"}
Expected Return: ${request.expectedReturnDate || "Not set"}

This is an automated email from QBorrow.
`;

  return {
    subject: content.subject,
    htmlContent,
    textContent,
  };
}

async function sendBrevoEmail({
  toEmail,
  toName,
  subject,
  htmlContent,
  textContent,
}) {
  if (!toEmail) {
    console.log("Email skipped: missing recipient email.");
    return null;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": BREVO_API_KEY.value(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: BREVO_SENDER_NAME.value() || "QBorrow",
        email: BREVO_SENDER_EMAIL.value(),
      },
      to: [
        {
          email: toEmail,
          name: toName || toEmail,
        },
      ],
      subject,
      htmlContent,
      textContent,
      tags: ["qborrow", "borrow-request"],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo email failed: ${response.status} ${errorBody}`);
  }

  return response.json();
}

exports.seedDefaultCategories = onCall(async (request) => {
  const currentUser = await requireSuperAdmin(request);

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  DEFAULT_CATEGORIES.forEach((category) => {
    const categoryRef = db.collection("categories").doc(category.id);

    batch.set(
      categoryRef,
      {
        id: category.id,
        name: category.name,
        isActive: true,
        createdBy: currentUser.uid,
        updatedBy: currentUser.uid,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  await batch.commit();

  return {
    success: true,
    message: "Default categories are ready.",
  };
});

exports.addCategory = onCall(async (request) => {
  const currentUser = await requireSuperAdmin(request);

  const name = cleanText(request.data && request.data.name);
  const customId = cleanText(request.data && request.data.id);

  if (!name) {
    throw new HttpsError("invalid-argument", "Category name is required.");
  }

  const categoryId = normalizeCategoryId(customId || name);

  if (!categoryId) {
    throw new HttpsError("invalid-argument", "Invalid category name.");
  }

  const categoryRef = db.collection("categories").doc(categoryId);
  const categorySnap = await categoryRef.get();

  if (categorySnap.exists) {
    throw new HttpsError("already-exists", "Category already exists.");
  }

  await categoryRef.set({
    id: categoryId,
    name,
    isActive: true,
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    category: {
      id: categoryId,
      name,
    },
  };
});

exports.deleteCategory = onCall(async (request) => {
  await requireSuperAdmin(request);

  const categoryId = normalizeCategoryId(
    request.data && request.data.categoryId
  );

  if (!categoryId) {
    throw new HttpsError("invalid-argument", "Category ID is required.");
  }

  const categoryRef = db.collection("categories").doc(categoryId);
  const categorySnap = await categoryRef.get();

  if (!categorySnap.exists) {
    throw new HttpsError("not-found", "Category does not exist.");
  }

  const hasItemsByCategoryId = await collectionHasMatch(
    "items",
    "categoryId",
    categoryId
  );

  const hasItemsByCategory = await collectionHasMatch(
    "items",
    "category",
    categoryId
  );

  const hasAdmins = await collectionHasArrayMatch(
    "users",
    "assignedCategories",
    categoryId
  );

  const hasRequestsByCategoryId = await collectionHasMatch(
    "borrowRequests",
    "categoryId",
    categoryId
  );

  const hasRequestsByCategory = await collectionHasMatch(
    "borrowRequests",
    "category",
    categoryId
  );

  if (
    hasItemsByCategoryId ||
    hasItemsByCategory ||
    hasAdmins ||
    hasRequestsByCategoryId ||
    hasRequestsByCategory
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This category cannot be deleted because it is still used by items, admins, or borrow requests."
    );
  }

  await categoryRef.delete();

  return {
    success: true,
    message: "Category deleted successfully.",
  };
});

exports.deleteUserCompletely = onCall(async (request) => {
  await requireSuperAdmin(request);

  const targetUid = cleanText(request.data && request.data.uid);

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "User UID is required.");
  }

  if (request.auth.uid === targetUid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot delete your own super admin account."
    );
  }

  const userRef = db.collection("users").doc(targetUid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User document does not exist.");
  }

  const userData = userSnap.data();

  if (userData.role === "superAdmin") {
    throw new HttpsError(
      "failed-precondition",
      "Super admin accounts cannot be deleted here."
    );
  }

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw new HttpsError("internal", error.message);
    }
  }

  if (userData.photoPath) {
    try {
      await admin.storage().bucket().file(userData.photoPath).delete();
    } catch (error) {
      if (error.code !== 404) {
        console.warn("Profile photo delete warning:", error.message);
      }
    }
  }

  await userRef.delete();

  return {
    success: true,
    message: "User deleted from Firebase Auth and Firestore.",
  };
});

function isValidEmailFormat(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

exports.updateUserEmail = onCall(async (request) => {
  await requireSuperAdmin(request);

  const targetUid = cleanText(request.data && request.data.uid);
  const newEmail = cleanText(request.data && request.data.email).toLowerCase();

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "User UID is required.");
  }

  if (!newEmail || !isValidEmailFormat(newEmail)) {
    throw new HttpsError("invalid-argument", "A valid email address is required.");
  }

  const userRef = db.collection("users").doc(targetUid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User document does not exist.");
  }

  const userData = userSnap.data();

  if (userData.role === "superAdmin") {
    throw new HttpsError(
      "failed-precondition",
      "Super admin accounts cannot be edited here."
    );
  }

  if ((userData.email || "").toLowerCase() === newEmail) {
    return {
      success: true,
      message: "Email unchanged.",
      email: newEmail,
    };
  }

  const emailTaken =
    (await authEmailExists(newEmail)) ||
    (await userFieldExists("email", newEmail)) ||
    (await userFieldExists("emailLower", newEmail));

  if (emailTaken) {
    throw new HttpsError("already-exists", "This email is already registered.");
  }

  try {
    await admin.auth().updateUser(targetUid, {
      email: newEmail,
      emailVerified: false,
    });
  } catch (error) {
    if (
      error.code === "auth/email-already-exists" ||
      error.code === "auth/email-already-in-use"
    ) {
      throw new HttpsError("already-exists", "This email is already registered.");
    }

    if (error.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Invalid email address.");
    }

    throw new HttpsError("internal", error.message || "Unable to update email.");
  }

  await userRef.update({
    email: newEmail,
    emailLower: newEmail,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: "Email updated successfully.",
    email: newEmail,
  };
});

exports.updateUserPassword = onCall(async (request) => {
  await requireSuperAdmin(request);

  const targetUid = cleanText(request.data && request.data.uid);
  const newPassword = String((request.data && request.data.password) || "");

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "User UID is required.");
  }

  if (newPassword.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "Password must be at least 6 characters."
    );
  }

  const userRef = db.collection("users").doc(targetUid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User document does not exist.");
  }

  const userData = userSnap.data();

  if (userData.role === "superAdmin") {
    throw new HttpsError(
      "failed-precondition",
      "Super admin accounts cannot be edited here."
    );
  }

  try {
    await admin.auth().updateUser(targetUid, { password: newPassword });
  } catch (error) {
    if (error.code === "auth/weak-password") {
      throw new HttpsError("invalid-argument", "Password is too weak.");
    }

    throw new HttpsError("internal", error.message || "Unable to update password.");
  }

  // Mirrors the same-day-login hygiene pattern used for newly created
  // borrowers: force the target user to set their own password on next
  // login instead of silently keeping the admin-typed one forever.
  await userRef.update({
    mustChangePassword: true,
    passwordChangedAt: "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: "Password updated successfully.",
  };
});

exports.bulkCreateBorrowers = onCall(async (request) => {
  const currentUser = await requireSuperAdmin(request);

  const borrowers =
    request.data && Array.isArray(request.data.borrowers)
      ? request.data.borrowers
      : [];

  if (borrowers.length === 0) {
    throw new HttpsError("invalid-argument", "Borrower list is empty.");
  }

  if (borrowers.length > 100) {
    throw new HttpsError(
      "invalid-argument",
      "You can import up to 100 borrowers per CSV upload."
    );
  }

  const results = [];
  const seenEmails = new Set();
  const seenStudentNumbers = new Set();
  const seenEmployeeIds = new Set();

  for (const borrower of borrowers) {
    const fullName = cleanText(borrower.fullName || borrower.name);
    const email = cleanText(borrower.email).toLowerCase();
    const password = String(borrower.password || "");
    const borrowerDetails = getBorrowerDetailsPayload(borrower);

    const studentNumberKey = normalizeUniqueKey(borrowerDetails.studentNumber);
    const employeeIdKey = normalizeUniqueKey(borrowerDetails.employeeId);

    if (!fullName || !email || !password) {
      results.push({
        email,
        success: false,
        message: "Missing name, email, or password.",
      });
      continue;
    }

    if (password.length < 6) {
      results.push({
        email,
        success: false,
        message: "Password must be at least 6 characters.",
      });
      continue;
    }

    if (seenEmails.has(email)) {
      results.push({
        email,
        success: false,
        message: "Duplicate email found inside the CSV file.",
      });
      continue;
    }

    if (borrowerDetails.userType === "Student" && !studentNumberKey) {
      results.push({
        email,
        success: false,
        message: "Student number is required for student borrowers.",
      });
      continue;
    }

    if (
      borrowerDetails.userType === "Student" &&
      seenStudentNumbers.has(studentNumberKey)
    ) {
      results.push({
        email,
        success: false,
        message: "Duplicate student number found inside the CSV file.",
      });
      continue;
    }

    if (
      (borrowerDetails.userType === "Faculty" ||
        borrowerDetails.userType === "Staff") &&
      !employeeIdKey
    ) {
      results.push({
        email,
        success: false,
        message: "Employee ID is required for faculty/staff borrowers.",
      });
      continue;
    }

    if (
      (borrowerDetails.userType === "Faculty" ||
        borrowerDetails.userType === "Staff") &&
      seenEmployeeIds.has(employeeIdKey)
    ) {
      results.push({
        email,
        success: false,
        message: "Duplicate employee ID found inside the CSV file.",
      });
      continue;
    }

    try {
      const emailAlreadyUsed =
        (await authEmailExists(email)) ||
        (await userFieldExists("email", email)) ||
        (await userFieldExists("emailLower", email));

      if (emailAlreadyUsed) {
        results.push({
          email,
          success: false,
          message: "This email is already registered.",
        });
        continue;
      }

      if (borrowerDetails.userType === "Student") {
        const studentNumberAlreadyUsed =
          (await userFieldExists("studentNumber", borrowerDetails.studentNumber)) ||
          (await userFieldExists("studentNumberKey", studentNumberKey));

        if (studentNumberAlreadyUsed) {
          results.push({
            email,
            success: false,
            message:
              "This student number is already registered. Same names are allowed, but student numbers must be unique.",
          });
          continue;
        }
      }

      if (
        borrowerDetails.userType === "Faculty" ||
        borrowerDetails.userType === "Staff"
      ) {
        const employeeIdAlreadyUsed =
          (await userFieldExists("employeeId", borrowerDetails.employeeId)) ||
          (await userFieldExists("employeeIdKey", employeeIdKey));

        if (employeeIdAlreadyUsed) {
          results.push({
            email,
            success: false,
            message:
              "This employee ID is already registered. Same names are allowed, but employee IDs must be unique.",
          });
          continue;
        }
      }

      seenEmails.add(email);

      if (borrowerDetails.userType === "Student") {
        seenStudentNumbers.add(studentNumberKey);
      }

      if (
        borrowerDetails.userType === "Faculty" ||
        borrowerDetails.userType === "Staff"
      ) {
        seenEmployeeIds.add(employeeIdKey);
      }

      let createdUser = null;

      try {
        createdUser = await admin.auth().createUser({
          email,
          password,
          displayName: fullName,
          disabled: false,
        });

        await db.collection("users").doc(createdUser.uid).set({
          fullName,
          email,
          emailLower: email,
          role: "borrower",
          assignedCategories: [],

          ...borrowerDetails,

          studentNumberKey:
            borrowerDetails.userType === "Student" ? studentNumberKey : "",
          employeeIdKey:
            borrowerDetails.userType === "Faculty" ||
            borrowerDetails.userType === "Staff"
              ? employeeIdKey
              : "",

          overdueCount: 0,
          suspendedUntil: "",
          suspensionReason: "",
          canBorrow: true,

          termsAccepted: false,
          termsAcceptedAt: "",
          termsVersion: "1.0",

          mustChangePassword: true,
          passwordChangedAt: "",

          createdBy: currentUser.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        results.push({
          email,
          uid: createdUser.uid,
          success: true,
          message: "Borrower created.",
        });
      } catch (error) {
        if (createdUser && createdUser.uid) {
          try {
            await admin.auth().deleteUser(createdUser.uid);
          } catch (deleteError) {
            console.warn(
              "Warning: failed to clean up Auth user after Firestore error:",
              deleteError.message
            );
          }
        }

        results.push({
          email,
          success: false,
          message: getAuthCreateErrorMessage(error),
        });
      }
    } catch (error) {
      results.push({
        email,
        success: false,
        message: error.message || "Unable to validate borrower.",
      });
    }
  }

  const created = results.filter((result) => result.success).length;
  const failed = results.length - created;

  return {
    success: failed === 0,
    created,
    failed,
    results,
  };
});
exports.sendBorrowRequestStatusEmail = onDocumentUpdated(
  {
    document: "borrowRequests/{requestId}",
    secrets: [BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME],
  },
  // FIX: Removed erroneous ``` markers that ChatGPT inserted around this block
  async (event) => {
    if (!event.data) {
      return null;
    }

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    const previousStatus = beforeData.approvalStatus || "";
    const nextStatus = afterData.approvalStatus || "";

    if (!nextStatus || previousStatus === nextStatus) {
      return null;
    }

    const allowedEmailStatuses = [
      "Approved",
      "Rejected",
      "Borrowed",
      "Returned",
      "Cancelled",
    ];

    if (!allowedEmailStatuses.includes(nextStatus)) {
      return null;
    }

    if (!afterData.borrowerEmail) {
      console.log("Email skipped: borrowerEmail is missing.");
      return null;
    }

    const emailContent = getBorrowRequestEmailContent(
      afterData,
      previousStatus,
      nextStatus
    );

    if (!emailContent) {
      return null;
    }

    await sendBrevoEmail({
      toEmail: afterData.borrowerEmail,
      toName: afterData.borrowerName || afterData.borrowerEmail,
      subject: emailContent.subject,
      htmlContent: emailContent.htmlContent,
      textContent: emailContent.textContent,
    });

    console.log(
      `Email sent to ${afterData.borrowerEmail} for status ${nextStatus}.`
    );

    return null;
  }
);