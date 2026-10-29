#include <stdio.h>
#include <stdlib.h>
typedef struct root Root;

int i = 0;

struct root {
	struct root* right;
	struct root* left;
	struct root* mid;
	char c;
	int i;
};

Root* create(char c) {
	Root* a = (Root*)malloc(sizeof(Root));
	a->left = NULL;
	a->right = NULL;
	a->mid = NULL;
	a->c = c;

	return a;
}

Root* root_create(char buf[500000]) {
	if (buf[i] == '(') {
		i++;
		root_create(buf);
	}
	Root* r = create(buf[i]);
}

Root* non_root(char buf[500000]){
	if (buf[i] == '(') {
		i++;
		root_create(buf);
	}
}

int solve() {
	char buf[500000];
	scanf("%s", buf);

}

int main(void)
{
	return 0;
}