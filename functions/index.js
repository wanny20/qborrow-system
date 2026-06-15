const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({ maxInstances: 10 });

const db = admin.firestore();

const DEFAULT_CATEGORIES = [
  { id: "sports", name: "Sports Items" },
  { id: "laboratory", name: "Laboratory Items" },
  { id: "stem", name: "STEM Items" },
  { id: "it", name: "IT Items" },
];

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeCategoryId(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function requireSuperAdmin(request) {
  if (!request.auth?.uid) {
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

  const name = cleanText(request.data?.name);
  const customId = cleanText(request.data?.id);

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

  const categoryId = normalizeCategoryId(request.data?.categoryId);

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

  const targetUid = cleanText(request.data?.uid);

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

exports.bulkCreateBorrowers = onCall(async (request) => {
  const currentUser = await requireSuperAdmin(request);

  const borrowers = Array.isArray(request.data?.borrowers)
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

  for (const borrower of borrowers) {
    const fullName = cleanText(borrower.fullName || borrower.name);
    const email = cleanText(borrower.email).toLowerCase();
    const password = String(borrower.password || "");

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

    try {
      const createdUser = await admin.auth().createUser({
        email,
        password,
        displayName: fullName,
        disabled: false,
      });

      await db.collection("users").doc(createdUser.uid).set({
        fullName,
        email,
        role: "borrower",
        assignedCategories: [],

        overdueCount: 0,
        suspendedUntil: "",
        suspensionReason: "",
        canBorrow: true,

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
      results.push({
        email,
        success: false,
        message: error.message,
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