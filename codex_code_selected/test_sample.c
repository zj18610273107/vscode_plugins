#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * test_sample.c — 选中这段代码，右键 "Codex: Send Selected Code to CLI"
 * 输入提示词试试效果，例如：Explain this code 或 Find bugs
 */

#define MAX_NAME_LEN  64
#define MAX_ITEMS     100

struct item {
	int id;
	char name[MAX_NAME_LEN];
	double price;
};

static struct item inventory[MAX_ITEMS];
static int item_count = 0;

int add_item(int id, const char *name, double price)
{
	if (!name || id < 0 || price < 0)
		return -1;
	if (item_count >= MAX_ITEMS)
		return -2;

	struct item *p = &inventory[item_count];
	p->id = id;
	strncpy(p->name, name, MAX_NAME_LEN - 1);
	p->name[MAX_NAME_LEN - 1] = '\0';
	p->price = price;
	item_count++;
	return 0;
}

const struct item *find_by_id(int id)
{
	for (int i = 0; i < item_count; i++) {
		if (inventory[i].id == id)
			return &inventory[i];
	}
	return NULL;
}

void print_inventory(void)
{
	printf("=== Inventory (%d items) ===\n", item_count);
	for (int i = 0; i < item_count; i++) {
		struct item *p = &inventory[i];
		printf("  [%d] %s — $%.2f\n", p->id, p->name, p->price);
	}
}

int main(void)
{
	add_item(1, "Widget", 9.99);
	add_item(2, "Gadget", 24.95);
	add_item(3, "Doohickey", 5.49);

	print_inventory();

	const struct item *found = find_by_id(2);
	if (found)
		printf("\nFound: %s ($%.2f)\n", found->name, found->price);

	return 0;
}
