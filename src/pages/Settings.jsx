import { useEffect, useState } from "react";
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import ImageCropModal from "../components/ImageCropModal";
import "../styles/Settings.css";

function Settings() {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRecord, setUserRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [croppedPhotoBlob, setCroppedPhotoBlob] = useState(null);
  const [croppedPhotoSize, setCroppedPhotoSize] = useState(0);
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [themeMode, setThemeMode] = useState(
    localStorage.getItem("qborrowTheme") || "light"
  );

  const [profilePassword, setProfilePassword] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function getRoleLabel(role) {
    if (role === "superAdmin") return "Super Admin";
    if (role === "categoryAdmin") return "Category Admin";
    return "Borrower";
  }

  function getInitials(name, email) {
    const source = name || email || "User";

    const initials = source
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    return initials || "U";
  }

  function revokePreview(url) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("qborrowTheme", mode);
  }

  async function loadUserRecord(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = {
        id: userSnap.id,
        uid: user.uid,
        email: user.email,
        ...userSnap.data(),
      };

      setUserRecord(data);
      setFullName(data.fullName || "");

        const savedTheme =
          localStorage.getItem("qborrowTheme") || data.themeMode || "light";

        setThemeMode(savedTheme);
        applyTheme(savedTheme);

      if (data.photoURL) {
        setPhotoPreview(data.photoURL);
      }
    }
  }

  async function reauthenticateUser(password) {
    if (!currentUser?.email) {
      throw new Error("No logged-in user found.");
    }

    const credential = EmailAuthProvider.credential(
      currentUser.email,
      password
    );

    await reauthenticateWithCredential(currentUser, credential);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    showStatus("", "");

    if (!file.type.startsWith("image/")) {
      showStatus("Please upload an image file only.", "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showStatus("Image is too large. Please upload an image below 5MB.", "error");
      return;
    }

    setCropSourceFile(file);
  }

  function handleProfileCropComplete(blob, previewUrl) {
    revokePreview(photoPreview);

    setCroppedPhotoBlob(blob);
    setCroppedPhotoSize(blob.size);
    setPhotoPreview(previewUrl);
    setCropSourceFile(null);

    showStatus(
      `Profile picture cropped and compressed to ${(blob.size / 1024).toFixed(
        1
      )} KB. Enter your password to save.`,
      "success"
    );
  }

  async function handleSaveProfile(event) {
    event.preventDefault();

    if (!currentUser) {
      showStatus("No logged-in user found.", "error");
      return;
    }

    const cleanedFullName = fullName.trim();

    if (!cleanedFullName) {
      showStatus("Please enter your display name.", "error");
      return;
    }

    if (!profilePassword) {
      showStatus("Please enter your current password to save changes.", "error");
      return;
    }

    setSavingProfile(true);
    showStatus("", "");

    try {
      await reauthenticateUser(profilePassword);

      let uploadedPhotoURL = userRecord?.photoURL || "";
      let uploadedPhotoPath = userRecord?.photoPath || "";

      if (croppedPhotoBlob) {
        uploadedPhotoPath = `profilePictures/${currentUser.uid}/avatar.jpg`;

        const photoRef = ref(storage, uploadedPhotoPath);

        await uploadBytes(photoRef, croppedPhotoBlob, {
          contentType: "image/jpeg",
          cacheControl: "public,max-age=3600",
        });

        uploadedPhotoURL = await getDownloadURL(photoRef);
      }

      const userRef = doc(db, "users", currentUser.uid);

      await updateDoc(userRef, {
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
        themeMode,
        updatedAt: serverTimestamp(),
      });

      applyTheme(themeMode);

      const updatedUserData = {
        ...userRecord,
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
        themeMode,
      };

      setUserRecord(updatedUserData);
      setFullName(cleanedFullName);
      setCroppedPhotoBlob(null);
      setCroppedPhotoSize(0);
      setProfilePassword("");

      window.dispatchEvent(
        new CustomEvent("qborrow-user-updated", {
          detail: {
            fullName: cleanedFullName,
            photoURL: uploadedPhotoURL,
            photoPath: uploadedPhotoPath,
            themeMode,
          },
        })
      );

      showStatus("Settings saved successfully.", "success");
    } catch (error) {
      showStatus("Error saving settings: " + error.message, "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();

    if (!currentUser) {
      showStatus("No logged-in user found.", "error");
      return;
    }

    if (!passwordCurrent) {
      showStatus("Please enter your current password.", "error");
      return;
    }

    if (newPassword.length < 6) {
      showStatus("New password must be at least 6 characters.", "error");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      showStatus("New passwords do not match.", "error");
      return;
    }

    setChangingPassword(true);
    showStatus("", "");

    try {
      await reauthenticateUser(passwordCurrent);
      await updatePassword(currentUser, newPassword);

      setPasswordCurrent("");
      setNewPassword("");
      setConfirmNewPassword("");

      showStatus("Password changed successfully.", "success");
    } catch (error) {
      showStatus("Error changing password: " + error.message, "error");
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem("qborrowTheme") || "light";
    applyTheme(savedTheme);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      setCurrentUser(user);

      try {
        await loadUserRecord(user);
      } catch (error) {
        showStatus("Error loading settings: " + error.message, "error");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading settings...</h2>
          <p>Preparing your account preferences.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          title="Crop Profile Picture"
          outputSize={320}
          maxOutputBytes={190 * 1024}
          onCancel={() => setCropSourceFile(null)}
          onCropComplete={handleProfileCropComplete}
        />
      )}

      <section className="settings-header">
        <div>
          <p className="qb-kicker">Account Customization</p>
          <h1>Settings</h1>
          <p>
            Customize your profile picture, display name, appearance, and account
            security. Email changes are disabled for account safety.
          </p>
        </div>
      </section>

      {statusMessage && (
        <div className={`settings-status settings-status-${statusType}`}>
          {statusMessage}
        </div>
      )}

      <section className="settings-layout">
        <form
          className="settings-card settings-profile-card"
          onSubmit={handleSaveProfile}
        >
          <div className="settings-section-heading">
            <h2>Profile & Appearance</h2>
            <p>
              Uploads are manually cropped into a square and compressed to save
              Firebase Storage.
            </p>
          </div>

          <div className="settings-profile-preview">
            <div className="settings-avatar">
              {photoPreview ? (
                <img src={photoPreview} alt="Profile preview" />
              ) : (
                <span>
                  {getInitials(fullName || userRecord?.fullName, currentUser?.email)}
                </span>
              )}
            </div>

            <div>
              <h3>{fullName || userRecord?.fullName || "Unnamed User"}</h3>
              <p>{getRoleLabel(userRecord?.role)}</p>
              <span>{currentUser?.email}</span>
            </div>
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="full-name">
              Display Name
            </label>

            <input
              id="full-name"
              type="text"
              placeholder="Enter your display name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="profile-photo">
              Profile Picture
            </label>

            <input
              id="profile-photo"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
            />

            {croppedPhotoSize > 0 && (
              <small>
                Compressed size: {(croppedPhotoSize / 1024).toFixed(1)} KB
              </small>
            )}
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="email">
              Email
            </label>

            <input
              id="email"
              type="email"
              value={currentUser?.email || ""}
              readOnly
            />

            <small>Email cannot be changed in this system.</small>
          </div>

          <div className="settings-theme-box">
            <div>
              <h3>Dark Mode</h3>
              <p>Switch between light and dark interface mode.</p>
            </div>

            <button
              type="button"
              className={`settings-theme-toggle ${
                themeMode === "dark" ? "active" : ""
              }`}
              onClick={() =>
                setThemeMode((current) =>
                  current === "dark" ? "light" : "dark"
                )
              }
            >
              <span></span>
              {themeMode === "dark" ? "Dark" : "Light"}
            </button>
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="profile-password">
              Current Password Required
            </label>

            <input
              id="profile-password"
              type="password"
              placeholder="Enter password to save changes"
              value={profilePassword}
              onChange={(event) => setProfilePassword(event.target.value)}
            />
          </div>

          <button
            type="submit"
            className="settings-primary-btn"
            disabled={savingProfile}
          >
            {savingProfile ? "Saving..." : "Save Settings"}
          </button>
        </form>

        <form
          className="settings-card settings-password-card"
          onSubmit={handleChangePassword}
        >
          <div className="settings-section-heading">
            <h2>Change Password</h2>
            <p>
              Your email stays the same. Enter your current password before
              setting a new one.
            </p>
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="current-password">
              Current Password
            </label>

            <input
              id="current-password"
              type="password"
              placeholder="Current password"
              value={passwordCurrent}
              onChange={(event) => setPasswordCurrent(event.target.value)}
            />
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="new-password">
              New Password
            </label>

            <input
              id="new-password"
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="confirm-new-password">
              Confirm New Password
            </label>

            <input
              id="confirm-new-password"
              type="password"
              placeholder="Repeat new password"
              value={confirmNewPassword}
              onChange={(event) => setConfirmNewPassword(event.target.value)}
            />
          </div>

          <button
            type="submit"
            className="settings-secondary-btn"
            disabled={changingPassword}
          >
            {changingPassword ? "Changing..." : "Change Password"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default Settings;