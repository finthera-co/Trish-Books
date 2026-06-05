CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.inventory_items
       SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + NEW.quantity,
           updated_at = now()
     WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.item_id = OLD.item_id THEN
      UPDATE public.inventory_items
         SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + (NEW.quantity - OLD.quantity),
             updated_at = now()
       WHERE id = NEW.item_id;
    ELSE
      UPDATE public.inventory_items
         SET quantity_on_hand = COALESCE(quantity_on_hand, 0) - OLD.quantity,
             updated_at = now()
       WHERE id = OLD.item_id;
      UPDATE public.inventory_items
         SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + NEW.quantity,
             updated_at = now()
       WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.inventory_items
       SET quantity_on_hand = COALESCE(quantity_on_hand, 0) - OLD.quantity,
           updated_at = now()
     WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- Backfill quantity_on_hand from existing stock_movements so current data matches
UPDATE public.inventory_items ii
   SET quantity_on_hand = COALESCE(sm.total, 0),
       updated_at = now()
  FROM (
    SELECT item_id, SUM(quantity) AS total
      FROM public.stock_movements
     GROUP BY item_id
  ) sm
 WHERE ii.id = sm.item_id;