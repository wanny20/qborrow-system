import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

function ItemDetails() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchItem() {
      try {
        const itemRef = doc(db, "items", id);
        const itemSnap = await getDoc(itemRef);

        if (itemSnap.exists()) {
          setItem({
            id: itemSnap.id,
            ...itemSnap.data(),
          });
        } else {
          alert("Item not found.");
        }
      } catch (error) {
        alert("Error loading item: " + error.message);
      }

      setLoading(false);
    }

    fetchItem();
  }, [id]);

  if (loading) {
    return <h2>Loading item details...</h2>;
  }

  if (!item) {
    return (
      <div>
        <h1>Item Not Found</h1>
        <button onClick={() => (window.location.href = "/items")}>
          Back to Items
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Item Details</h1>

      <p>
        <strong>Item ID:</strong> {item.id}
      </p>

      <p>
        <strong>Item Name:</strong> {item.itemName}
      </p>

      <p>
        <strong>Category:</strong> {item.category}
      </p>

      <p>
        <strong>Condition:</strong> {item.condition}
      </p>

      <p>
        <strong>Availability:</strong> {item.availability}
      </p>

      {item.availability === "Available" ? (
        <button onClick={() => (window.location.href = `/borrow-request/${item.id}`)}>
          Borrow This Item
        </button>
      ) : (
        <p>This item is currently not available for borrowing.</p>
      )}

      <br />
      <br />

      <button onClick={() => (window.location.href = "/items")}>
        Back to Items
      </button>
    </div>
  );
}

export default ItemDetails;