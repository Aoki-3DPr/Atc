#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll a, b;
	cin >> a >> b;
	if (a * b < 0) {
		cout << "No" << endl;
	} else {
		cout << "Yes" << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
