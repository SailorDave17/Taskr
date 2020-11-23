import com.example.demo.resources.Household;
import com.example.demo.resources.HouseholdRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

@DataJpaTest
public class JPAWiringTest {

        private HouseholdRepository householdRepo;

    @Test
    public void householdRepoShouldSaveAndRetrieveUsersAndTasks() {
        Household testHousehold = new Household("user", "task")

        householdRepo.save(testHousehold);

    }
}
